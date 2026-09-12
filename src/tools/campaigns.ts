import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MAX_PAGE_SIZE } from "../config.js";
import { apiRequest } from "../lib/api.js";
import { AraraError } from "../lib/errors.js";
import { resolveRecipient } from "../lib/recipients.js";
import {
  campaignDetailSchema,
  campaignEstimateSchema,
  campaignListSchema,
  campaignSchema,
  pagedTemplatesSchema,
} from "../lib/schemas.js";
import { templateButtonLabels } from "../lib/templates.js";
import { renderTemplateBody } from "../ui/model/format.js";
import { uiResourceUri } from "../ui/resources.js";
import { execute } from "../mcp/result.js";
import { readOnly, register, write } from "./register.js";
import { e164Schema, recipientInputSchema, variablesSchema } from "./send.js";

const MAX_BROADCAST_RECIPIENTS = 1000;
const MAX_UNRESOLVED_LISTED = 10;
const DEFAULT_CAMPAIGN_PAGE_SIZE = 20;
const AB_DEFAULT_SAMPLE_PCT = 20;
const AB_DEFAULT_SPLIT_PCT = 50;
const AB_DEFAULT_DECISION_MINUTES = 240;
const AB_DEFAULT_METRIC = "CLICKED";

const idSchema = z.string().uuid();
const recipientEntrySchema = z.union([
  recipientInputSchema,
  z.object({ to: recipientInputSchema, variables: variablesSchema }),
]);
const recipientsSchema = z.array(recipientEntrySchema).min(1).max(MAX_BROADCAST_RECIPIENTS);
const abTestSchema = z.object({
  variantBTemplateName: z.string().trim().min(1),
  metric: z.enum(["DELIVERED", "READ", "CLICKED", "CONVERTED"]).default(AB_DEFAULT_METRIC),
  samplePct: z.number().int().min(1).max(99).default(AB_DEFAULT_SAMPLE_PCT),
  decisionWindowMinutes: z.number().int().min(1).default(AB_DEFAULT_DECISION_MINUTES),
  autopilot: z.boolean().default(true),
});

type RecipientEntry = z.infer<typeof recipientEntrySchema>;
type CampaignContact = { to: string; variables: string[] };

export const resolveCampaignContacts = async (
  entries: RecipientEntry[],
  sharedVariables: string[],
): Promise<{ contacts: CampaignContact[]; unresolved: string[] }> => {
  const settled = await Promise.all(
    entries.map(async (entry) => {
      const to = typeof entry === "string" ? entry : entry.to;
      const variables = typeof entry === "string" ? sharedVariables : entry.variables;
      try {
        const recipient = await resolveRecipient(to);
        return { to: recipient.phone, variables };
      } catch {
        return { unresolved: to };
      }
    }),
  );
  const contacts = settled.filter((item): item is CampaignContact => "to" in item);
  const unresolved = settled
    .filter((item): item is { unresolved: string } => "unresolved" in item)
    .map((item) => item.unresolved);
  return { contacts, unresolved };
};

const defaultCampaignName = (): string =>
  `Broadcast ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;

const buildAbTest = (raw: unknown): Record<string, unknown> | undefined => {
  if (raw === undefined) return undefined;
  const parsed = abTestSchema.parse(raw);
  return { ...parsed, splitPct: AB_DEFAULT_SPLIT_PCT };
};

type BroadcastPlan = {
  name: string;
  templateName: string;
  contacts: CampaignContact[];
  unresolved: string[];
  sender?: string | undefined;
  scheduledAt?: string | undefined;
  abTest?: Record<string, unknown> | undefined;
};

const planBroadcast = async (input: Record<string, unknown>): Promise<BroadcastPlan> => {
  const entries = recipientsSchema.parse(input.to);
  const shared = variablesSchema.parse(input.variables);
  const { contacts, unresolved } = await resolveCampaignContacts(entries, shared);
  if (contacts.length === 0) {
    throw new AraraError(
      "NO_VALID_RECIPIENTS",
      `No recipient could be resolved: ${unresolved.join(", ")}.`,
      400,
      false,
    );
  }
  return {
    name: typeof input.name === "string" ? input.name : defaultCampaignName(),
    templateName: z.string().trim().min(1).parse(input.templateName),
    contacts,
    unresolved,
    sender: typeof input.from === "string" ? input.from : undefined,
    scheduledAt: typeof input.scheduledAt === "string" ? input.scheduledAt : undefined,
    abTest: buildAbTest(input.abTest),
  };
};

type TemplatePreview = { renderedBody: string; buttons: string[]; category: string };

/** Template body and buttons rendered with the first contact's variables. Never blocks a send. */
const loadTemplatePreview = async (plan: BroadcastPlan): Promise<TemplatePreview> => {
  const fallback: TemplatePreview = { renderedBody: "", buttons: [], category: "" };
  const params = new URLSearchParams({ name: plan.templateName, size: "1" });
  const templates = await apiRequest(`/v1/templates?${params.toString()}`, {
    schema: pagedTemplatesSchema,
  }).catch(() => []);
  const [template] = templates;
  if (template === undefined) return fallback;
  const body = typeof template.bodyPreview === "string" ? template.bodyPreview : "";
  const variables = plan.contacts[0]?.variables ?? [];
  return {
    renderedBody: renderTemplateBody(body, variables),
    buttons: templateButtonLabels(template.structureJson),
    category: template.category,
  };
};

const previewRequest = (input: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(input).filter(([key, value]) => key !== "dryRun" && value !== undefined),
  );

const previewBroadcast = async (input: Record<string, unknown>) => {
  const plan = await planBroadcast(input);
  const [template, estimate] = await Promise.all([
    loadTemplatePreview(plan),
    apiRequest("/v1/campaigns/estimate", {
      method: "POST",
      body: { templateName: plan.templateName, phones: plan.contacts.map((contact) => contact.to) },
      schema: campaignEstimateSchema,
      retry: false,
    }),
  ]);
  const data = {
    preview: true,
    templateName: plan.templateName,
    renderedBody: template.renderedBody,
    buttons: template.buttons,
    category: template.category || estimate.templateCategory,
    recipients: plan.contacts.length,
    unresolved: plan.unresolved,
    totalCost: estimate.totalCost,
    unitPrice: estimate.unitPrice,
    abTest: plan.abTest,
    scheduledAt: plan.scheduledAt,
    request: previewRequest(input),
  };
  return {
    data,
    message: `Preview only, nothing sent. '${plan.templateName}' would reach ${plan.contacts.length} recipient(s) for ${estimate.totalCost.toFixed(2)}. Call broadcast again with dryRun=false to send.`,
  };
};

const sendBroadcast = async (input: Record<string, unknown>) => {
  const plan = await planBroadcast(input);
  const idempotencyKey =
    typeof input.idempotencyKey === "string" ? input.idempotencyKey : randomUUID();
  const [data, template] = await Promise.all([
    apiRequest("/v1/campaigns", {
      method: "POST",
      body: {
        name: plan.name,
        templateName: plan.templateName,
        contacts: plan.contacts,
        ...(plan.sender === undefined ? {} : { sender: plan.sender }),
        ...(plan.scheduledAt === undefined ? {} : { scheduledAt: plan.scheduledAt }),
        ...(plan.abTest === undefined ? {} : { abTest: plan.abTest }),
      },
      schema: campaignSchema,
      idempotencyKey,
    }),
    loadTemplatePreview(plan),
  ]);
  const unresolvedNote =
    plan.unresolved.length === 0
      ? ""
      : ` ${plan.unresolved.length} recipient(s) not resolved: ${plan.unresolved.slice(0, MAX_UNRESOLVED_LISTED).join(", ")}.`;
  return {
    data: {
      ...data,
      unresolved: plan.unresolved,
      idempotencyKey,
      renderedBody: template.renderedBody,
      buttons: template.buttons,
    },
    message: `Campaign '${data.name}' accepted for ${data.totalMessages} recipient(s), total cost ${data.totalCost.toFixed(2)}.${unresolvedNote} Follow it with campaign_report.`,
  };
};

const registerBroadcast = (server: McpServer): void => {
  register(
    server,
    "broadcast",
    "Send an approved template to many people at once (up to 1000) as a campaign. By default it is a dry run: it resolves the audience, renders the message and estimates the cost without sending, so the user can approve. Call again with dryRun=false to send. Each entry in 'to' is a phone or contact name (uses the shared 'variables') or an object {to, variables} for per-person values. Optional 'abTest' runs an A/B test; optional 'scheduledAt' (ISO-8601) schedules instead of sending now. Unresolved recipients are listed, not silently dropped.",
    {
      templateName: z.string().trim().min(1),
      to: recipientsSchema,
      variables: variablesSchema.default([]),
      name: z.string().trim().min(1).max(255).optional(),
      from: e164Schema.optional(),
      scheduledAt: z.string().datetime().optional(),
      abTest: abTestSchema.optional(),
      dryRun: z.boolean().default(true),
      idempotencyKey: z.string().uuid().optional(),
    },
    write,
    async (input) =>
      execute(async () =>
        input.dryRun === false ? sendBroadcast(input) : previewBroadcast(input),
      ),
    { ui: uiResourceUri("broadcast") },
  );
};

const listCampaigns = async (input: Record<string, unknown>) => {
  const page = z.number().int().nonnegative().default(0).parse(input.page);
  const size = z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_CAMPAIGN_PAGE_SIZE)
    .parse(input.size);
  const params = new URLSearchParams({ page: String(page), size: String(size) });
  if (typeof input.status === "string" && input.status.length > 0) {
    params.set("status", input.status);
  }
  const data = await apiRequest(`/v1/campaigns?${params.toString()}`, {
    schema: campaignListSchema,
  });
  return {
    data: { ...data, pagination: { ...data.pagination, page, size } },
    message: `${data.data.length} campaign(s) loaded. Pass campaignId for the full report.`,
  };
};

const getCampaign = async (campaignId: string) => {
  const data = await apiRequest(`/v1/campaigns/${campaignId}`, { schema: campaignDetailSchema });
  const pct = (count: number): string =>
    data.totalMessages > 0 ? ` (${Math.round((count / data.totalMessages) * 100)}%)` : "";
  const message = [
    `Campaign '${data.name}' [${data.status}] with template ${data.templateName}.`,
    `Sent ${data.sentCount}${pct(data.sentCount)}, delivered ${data.deliveredCount}${pct(data.deliveredCount)}, read ${data.readCount}${pct(data.readCount)}, clicked ${data.clickedCount}${pct(data.clickedCount)}, replied ${data.replyCount}${pct(data.replyCount)}.`,
    `Converted ${data.convertedCount} worth ${data.convertedValue.toFixed(2)}. Cost ${data.totalCost.toFixed(2)}.`,
  ].join(" ");
  return { data, message };
};

const registerCampaignReport = (server: McpServer): void => {
  register(
    server,
    "campaign_report",
    "See what came back. Without 'campaignId' it lists recent campaigns (newest first, optional 'status' filter such as COMPLETED, AB_TESTING, SCHEDULED, CANCELED). With 'campaignId' it returns the full report: sent, delivered, read, clicked, replied, converted with value, blocked with reasons, refunds and cost.",
    {
      campaignId: idSchema.optional(),
      status: z.string().trim().max(40).optional(),
      page: z.number().int().nonnegative().default(0),
      size: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_CAMPAIGN_PAGE_SIZE),
    },
    readOnly,
    async (input) =>
      execute(async () =>
        typeof input.campaignId === "string"
          ? getCampaign(idSchema.parse(input.campaignId))
          : listCampaigns(input),
      ),
    { ui: uiResourceUri("campaign") },
  );
};

export const registerCampaignTools = (server: McpServer): void => {
  registerBroadcast(server);
  registerCampaignReport(server);
};
