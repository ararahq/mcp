import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiRequest } from "../lib/api.js";
import { AraraError, toAraraError } from "../lib/errors.js";
import { E164_PATTERN, recipientLabel, resolveRecipient } from "../lib/recipients.js";
import { messageSchema, pagedTemplatesSchema, templateStatusSchema } from "../lib/schemas.js";
import { windowStatusSchema } from "../lib/schemas.js";
import { execute } from "../mcp/result.js";
import { uiResourceUri } from "../ui/resources.js";
import { readOnly, register, write } from "./register.js";

const WINDOW_CLOSED_CODE = "CONVERSATION_WINDOW_CLOSED";
const APPROVED_STATUS = "APPROVED";
const MAX_MESSAGE_LENGTH = 4096;
const MAX_VARIABLES = 20;
const MAX_VARIABLE_LENGTH = 1024;
const MAX_TEMPLATE_SUGGESTIONS = 10;

export const e164Schema = z.string().regex(E164_PATTERN, "Use E.164, for example +5511999999999.");
export const recipientInputSchema = z.string().trim().min(1).max(255);
export const variablesSchema = z.array(z.string().max(MAX_VARIABLE_LENGTH)).max(MAX_VARIABLES);
const idSchema = z.string().uuid();

export const loadApprovedTemplateNames = async (): Promise<string[]> => {
  const params = new URLSearchParams({ status: APPROVED_STATUS, size: "100" });
  const templates = await apiRequest(`/v1/templates?${params.toString()}`, {
    schema: pagedTemplatesSchema,
  });
  return templates
    .filter((template) => template.availableForSending)
    .map((template) => template.name);
};

const windowClosedError = async (label: string): Promise<AraraError> => {
  const approved = await loadApprovedTemplateNames().catch(() => []);
  const hint =
    approved.length === 0
      ? "There is no approved template yet. Create one with create_template."
      : `Approved templates: ${approved.slice(0, MAX_TEMPLATE_SUGGESTIONS).join(", ")}. Send one with send_whatsapp using templateName.`;
  return new AraraError(
    WINDOW_CLOSED_CODE,
    `The 24h window with ${label} is closed, so free text is not allowed. ${hint}`,
    422,
    false,
  );
};

type SendInput = {
  phone: string;
  message?: string;
  templateName?: string;
  variables: string[];
  from?: string;
  idempotencyKey: string;
};

const buildSendBody = (input: SendInput): Record<string, unknown> => {
  const base = input.from === undefined ? {} : { sender: input.from };
  if (input.templateName !== undefined) {
    return {
      ...base,
      receiver: input.phone,
      type: "template",
      templateName: input.templateName,
      variables: input.variables,
    };
  }
  return { ...base, receiver: input.phone, type: "text", body: input.message };
};

const sendOne = async (input: SendInput, label: string) => {
  try {
    return await apiRequest("/v1/messages", {
      method: "POST",
      body: buildSendBody(input),
      schema: messageSchema,
      idempotencyKey: input.idempotencyKey,
    });
  } catch (error) {
    const normalized = toAraraError(error);
    if (normalized.code === WINDOW_CLOSED_CODE && input.templateName === undefined) {
      throw await windowClosedError(label);
    }
    throw normalized;
  }
};

const registerSendWhatsapp = (server: McpServer): void => {
  register(
    server,
    "send_whatsapp",
    "Send one WhatsApp message to one person. Pass 'to' as a phone in any format or a saved contact name. Pass 'message' for free text (only works inside the 24h window) or 'templateName' + 'variables' for an approved template (works any time). If the window is closed the error lists your approved templates. For many people use broadcast.",
    {
      to: recipientInputSchema,
      message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH).optional(),
      templateName: z.string().trim().min(1).optional(),
      variables: variablesSchema.default([]),
      from: e164Schema.optional(),
      idempotencyKey: z.string().uuid().optional(),
    },
    write,
    async (input) =>
      execute(async () => {
        const message = typeof input.message === "string" ? input.message : undefined;
        const templateName =
          typeof input.templateName === "string" ? input.templateName : undefined;
        if ((message === undefined) === (templateName === undefined)) {
          throw new AraraError(
            "INVALID_INPUT",
            "Pass exactly one of 'message' (free text) or 'templateName' (approved template).",
            400,
            false,
          );
        }
        const recipient = await resolveRecipient(recipientInputSchema.parse(input.to));
        const label = recipientLabel(recipient);
        const idempotencyKey =
          typeof input.idempotencyKey === "string" ? input.idempotencyKey : randomUUID();
        const data = await sendOne(
          {
            phone: recipient.phone,
            variables: variablesSchema.parse(input.variables),
            idempotencyKey,
            ...(message === undefined ? {} : { message }),
            ...(templateName === undefined ? {} : { templateName }),
            ...(typeof input.from === "string" ? { from: input.from } : {}),
          },
          label,
        );
        return {
          data: { ...data, recipient, idempotencyKey },
          message: `Message to ${label} accepted (${data.status}). Check delivery with check_status.`,
        };
      }),
  );
};

const checkMessage = async (messageId: string) => {
  const data = await apiRequest(`/v1/messages/${encodeURIComponent(messageId)}`, {
    schema: messageSchema,
  });
  return { data, message: `Message ${messageId}: ${data.status}.` };
};

const checkTemplate = async (templateId: string) => {
  const data = await apiRequest(`/v1/templates/${templateId}/status`, {
    schema: templateStatusSchema,
  });
  const reason =
    typeof data.rejectionReason === "string" && data.rejectionReason.length > 0
      ? ` Reason: ${data.rejectionReason}`
      : "";
  return { data, message: `Template ${templateId}: ${data.status}.${reason}` };
};

const checkWindow = async (to: string) => {
  const recipient = await resolveRecipient(to);
  const result = await apiRequest("/v1/conversations/window-status", {
    method: "POST",
    body: { phones: [recipient.phone] },
    schema: windowStatusSchema,
    retry: false,
  });
  const [status] = result.results;
  const isWindowOpen = status?.isWindowOpen === true;
  const hours =
    typeof status?.hoursRemaining === "number" ? `${status.hoursRemaining.toFixed(1)}h left` : "";
  const label = recipientLabel(recipient);
  const message = isWindowOpen
    ? `${label}: window OPEN (${hours}). Free text is allowed.`
    : `${label}: window CLOSED. Only an approved template can be sent.`;
  return { data: { recipient, isWindowOpen, ...status }, message };
};

const registerCheckStatus = (server: McpServer): void => {
  register(
    server,
    "check_status",
    "Answer 'did it arrive?', 'can I text them now?' and 'was my template approved?'. Pass exactly one of: 'to' (phone or contact name, returns whether the 24h window is open), 'messageId' (the id returned by send_whatsapp; delivery status and cost) or 'templateId' (Meta approval status with the rejection reason).",
    {
      to: recipientInputSchema.optional(),
      messageId: z.string().trim().min(1).optional(),
      templateId: idSchema.optional(),
    },
    readOnly,
    async (input) =>
      execute(async () => {
        const provided = ["to", "messageId", "templateId"].filter(
          (key) => typeof input[key] === "string",
        );
        if (provided.length !== 1) {
          throw new AraraError(
            "INVALID_INPUT",
            "Pass exactly one of 'to', 'messageId' or 'templateId'.",
            400,
            false,
          );
        }
        if (typeof input.messageId === "string") return checkMessage(input.messageId);
        if (typeof input.templateId === "string")
          return checkTemplate(idSchema.parse(input.templateId));
        return checkWindow(recipientInputSchema.parse(input.to));
      }),
    { ui: uiResourceUri("status") },
  );
};

export const registerSendTools = (server: McpServer): void => {
  registerSendWhatsapp(server);
  registerCheckStatus(server);
};
