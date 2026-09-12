import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiRequest } from "../lib/api.js";
import { recipientLabel, resolveRecipient } from "../lib/recipients.js";
import {
  contactsBatchSchema,
  conversationSchema,
  jsonValueSchema,
  mutationSchema,
} from "../lib/schemas.js";
import { execute } from "../mcp/result.js";
import { uiResourceUri } from "../ui/resources.js";
import { destructive, idempotentWrite, readOnly, register } from "./register.js";
import { e164Schema, recipientInputSchema } from "./send.js";

const MAX_CONTACTS_PER_BATCH = 1000;
const MAX_CONTACT_NAME = 255;
const MAX_EMAIL = 255;
const MAX_ERRORS_LISTED = 10;
const MAX_OPT_OUT_REASON = 80;
const DEFAULT_CONVERSATION_LIMIT = 30;
const MAX_CONVERSATION_LIMIT = 100;
const INBOUND_DIRECTION = "INBOUND";

const contactSchema = z.object({
  name: z.string().trim().min(1).max(MAX_CONTACT_NAME),
  phone: e164Schema,
  email: z.string().email().max(MAX_EMAIL).optional(),
  attributes: z.record(jsonValueSchema).optional(),
});
const contactsSchema = z.array(contactSchema).min(1).max(MAX_CONTACTS_PER_BATCH);

const registerSaveContacts = (server: McpServer): void => {
  register(
    server,
    "save_contacts",
    "Create or update up to 1000 contacts in one call so you can message people by name. Phone must be E.164 (+5511999998888). Returns created, updated and skipped counts plus per-row errors.",
    { contacts: contactsSchema },
    idempotentWrite,
    async (input) =>
      execute(async () => {
        const contacts = contactsSchema.parse(input.contacts);
        const data = await apiRequest("/v1/contacts/batch", {
          method: "POST",
          body: contacts,
          schema: contactsBatchSchema,
          retry: false,
        });
        const errors =
          data.errors.length === 0
            ? ""
            : ` ${data.errors.length} error(s): ${data.errors
                .slice(0, MAX_ERRORS_LISTED)
                .map((item) => `#${item.index} ${item.phone ?? "?"} ${item.reason}`)
                .join("; ")}.`;
        return {
          data,
          message: `Contacts saved: ${data.created} created, ${data.updated} updated, ${data.skipped} skipped.${errors}`,
        };
      }),
  );
};

const registerOptOut = (server: McpServer): void => {
  register(
    server,
    "opt_out",
    "Record that a person no longer wants messages from this organization. Idempotent. Use whenever someone replies STOP/PARAR or asks to leave; the backend then blocks every send to them.",
    { phone: e164Schema, reason: z.string().trim().min(1).max(MAX_OPT_OUT_REASON).optional() },
    destructive,
    async (input) =>
      execute(async () => ({
        data: await apiRequest("/v1/opt-outs", {
          method: "POST",
          body: {
            phone: input.phone,
            ...(typeof input.reason === "string" ? { reason: input.reason } : {}),
          },
          schema: mutationSchema,
          retry: false,
        }),
        message: `Opt-out recorded for ${String(input.phone)}.`,
      })),
  );
};

const registerReadConversation = (server: McpServer): void => {
  register(
    server,
    "read_conversation",
    "Read what a person actually wrote: the raw message timeline with one contact, newest first, each line marked as customer or you. Use it to judge a reply before answering with send_whatsapp.",
    {
      to: recipientInputSchema,
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_CONVERSATION_LIMIT)
        .default(DEFAULT_CONVERSATION_LIMIT),
    },
    readOnly,
    async (input) =>
      execute(async () => {
        const recipient = await resolveRecipient(recipientInputSchema.parse(input.to));
        const limit = z.number().int().min(1).max(MAX_CONVERSATION_LIMIT).parse(input.limit);
        const params = new URLSearchParams({ limit: String(limit) });
        const data = await apiRequest(
          `/v1/contacts/${recipient.phone}/messages?${params.toString()}`,
          { schema: conversationSchema },
        );
        const inbound = data.messages.filter(
          (item) => item.direction.toUpperCase() === INBOUND_DIRECTION,
        ).length;
        return {
          data: { ...data, recipient },
          message: `${data.total} message(s) with ${recipientLabel(recipient)}, ${inbound} from the customer in this page.`,
        };
      }),
    { ui: uiResourceUri("conversation") },
  );
};

export const registerContactTools = (server: McpServer): void => {
  registerSaveContacts(server);
  registerOptOut(server);
  registerReadConversation(server);
};
