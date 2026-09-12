import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { adminRequest } from "../lib/admin.js";
import { apiRequest } from "../lib/api.js";
import { assertOperatorAllowed } from "../lib/operator-access.js";
import type { templatesSchema } from "../lib/schemas.js";
import { jsonValueSchema, pagedTemplatesSchema } from "../lib/schemas.js";
import { execute } from "../mcp/result.js";
import {
  destructive,
  idempotentWrite,
  readOnly,
  register as registerSharedTool,
  write,
} from "./register.js";

const idSchema = z.string().uuid();
const amountSchema = z.number().positive().max(1_000_000);

/**
 * Listing never exposes key material: only fields on this allowlist survive,
 * regardless of what the backend returns.
 */
export const safeApiKeySchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    prefix: z.string().optional(),
    last4: z.string().optional(),
    maskedKey: z.string().optional(),
    scope: z.string().optional(),
    mode: z.string().optional(),
    createdAt: z.string().optional(),
    expiresAt: z.string().nullable().optional(),
  })
  .strip();

const walletMutationSchema = z
  .object({ status: z.string(), organizationId: z.string(), amount: z.string() })
  .passthrough();
const balanceSchema = z
  .object({ organizationId: z.string(), balance: z.union([z.number(), z.string()]) })
  .passthrough();
const failureBreakdownSchema = z
  .object({
    windowHours: z.number(),
    totalMessages: z.number(),
    totalFailures: z.number(),
    byReason: z.record(z.number()),
    byTemplate: z.record(z.number()),
    topCodes: z.record(z.number()),
  })
  .passthrough();
const anyRecordSchema = z.record(jsonValueSchema);

export const filterTemplates = (
  templates: z.infer<typeof templatesSchema>,
  filter: string | undefined,
): z.infer<typeof templatesSchema> => {
  if (filter === undefined || filter.length === 0) return templates;
  const needle = filter.toLowerCase();
  return templates.filter(
    (template) =>
      template.name.toLowerCase().includes(needle) ||
      template.providerStatus.toLowerCase().includes(needle) ||
      template.category.toLowerCase().includes(needle),
  );
};

/** Every operator tool runs behind the e-mail allowlist gate (fail closed). */
const register = (
  server: McpServer,
  name: string,
  description: string,
  inputSchema: Record<string, z.ZodTypeAny>,
  annotations: typeof readOnly,
  handler: (input: Record<string, unknown>) => Promise<unknown>,
): void => {
  registerSharedTool(server, name, description, inputSchema, annotations, handler, {
    gate: () => assertOperatorAllowed(),
  });
};

export const OPERATOR_TOOL_NAMES = [
  "create_api_key",
  "list_api_keys",
  "revoke_api_key",
  "configure_webhook_route",
  "list_templates",
  "delete_template",
  "template_health",
  "list_failures",
  "get_balance",
  "add_credit",
  "remove_credit",
  "list_transactions",
] as const;

export const registerOperatorTools = (server: McpServer): void => {
  register(
    server,
    "create_api_key",
    "Create an API key. The key value is returned ONCE in this response and can never be listed again.",
    {
      name: z.string().trim().min(1).max(255),
      mode: z.enum(["LIVE", "TEST"]).default("LIVE"),
      scope: z.enum(["ADMIN", "SEND_ONLY"]).default("ADMIN"),
    },
    write,
    async (input) =>
      execute(async () => ({
        data: await apiRequest("/v1/api-keys", {
          method: "POST",
          body: { name: input.name, mode: input.mode, scope: input.scope },
          schema: anyRecordSchema,
          retry: false,
        }),
        message: "API key created. Store the key value now: it will never be shown again.",
      })),
  );

  register(
    server,
    "list_api_keys",
    "List API keys (prefix, last4 and scope only — never the key value).",
    {},
    readOnly,
    async () =>
      execute(async () => {
        const keys = await apiRequest("/v1/api-keys", { schema: z.array(safeApiKeySchema) });
        return { data: keys, message: `${keys.length} API key(s) loaded.` };
      }),
  );

  register(
    server,
    "revoke_api_key",
    "Revoke an API key permanently.",
    { apiKeyId: idSchema },
    destructive,
    async (input) =>
      execute(async () => {
        const apiKeyId = idSchema.parse(input.apiKeyId);
        await apiRequest(`/v1/api-keys/${apiKeyId}`, {
          method: "DELETE",
          schema: z.unknown(),
        });
        return { data: { apiKeyId, revoked: true }, message: "API key revoked." };
      }),
  );

  register(
    server,
    "configure_webhook_route",
    "Configure the A/B template pool for an API key's webhook send route.",
    {
      apiKeyId: idSchema,
      senderNumberId: idSchema,
      templateIds: z.array(idSchema).min(1).max(20),
      secondarySenderNumberId: idSchema.optional(),
    },
    idempotentWrite,
    async (input) =>
      execute(async () => {
        const apiKeyId = idSchema.parse(input.apiKeyId);
        return {
          data: await apiRequest(`/v1/api-keys/${apiKeyId}/webhook-route`, {
            method: "PUT",
            body: {
              senderNumberId: input.senderNumberId,
              templateIds: input.templateIds,
              ...(input.secondarySenderNumberId === undefined
                ? {}
                : { secondarySenderNumberId: input.secondarySenderNumberId }),
            },
            schema: anyRecordSchema,
          }),
          message: "Webhook route configured.",
        };
      }),
  );

  register(
    server,
    "list_templates",
    "List templates with name, status, category and availability. Optional filter matches name, status or category.",
    { filter: z.string().max(100).optional() },
    readOnly,
    async (input) =>
      execute(async () => {
        const templates = await apiRequest("/v1/templates?size=100", {
          schema: pagedTemplatesSchema,
        });
        const filter = typeof input.filter === "string" ? input.filter : undefined;
        const data = filterTemplates(templates, filter);
        return { data, message: `${data.length} template(s) loaded.` };
      }),
  );

  register(
    server,
    "delete_template",
    "Delete a template.",
    { templateId: idSchema },
    destructive,
    async (input) =>
      execute(async () => {
        const templateId = idSchema.parse(input.templateId);
        await apiRequest(`/v1/templates/${templateId}`, {
          method: "DELETE",
          schema: z.unknown(),
        });
        return { data: { templateId, deleted: true }, message: "Template deleted." };
      }),
  );

  register(
    server,
    "template_health",
    "Delivery, read and failure analytics for one template.",
    { templateId: idSchema },
    readOnly,
    async (input) =>
      execute(async () => {
        const templateId = idSchema.parse(input.templateId);
        return {
          data: await apiRequest(`/v1/templates/${templateId}/analytics`, {
            schema: anyRecordSchema,
          }),
          message: "Template health loaded.",
        };
      }),
  );

  register(
    server,
    "list_failures",
    "Admin: breakdown of send failures by reason (paused / recipient / media / other) in a time window.",
    { organizationId: idSchema, hours: z.number().int().min(1).max(720).default(24) },
    readOnly,
    async (input) =>
      execute(async () => {
        const organizationId = idSchema.parse(input.organizationId);
        const hours = z
          .number()
          .int()
          .min(1)
          .max(720)
          .parse(input.hours ?? 24);
        const data = await adminRequest(
          `/v1/admin/diagnostics/failures?organizationId=${organizationId}&hours=${hours}`,
          { schema: failureBreakdownSchema },
        );
        return {
          data,
          message: `${data.totalFailures} failure(s) in the last ${data.windowHours}h.`,
        };
      }),
  );

  register(
    server,
    "get_balance",
    "Admin: wallet balance for an organization.",
    { organizationId: idSchema },
    readOnly,
    async (input) =>
      execute(async () => {
        const organizationId = idSchema.parse(input.organizationId);
        const data = await adminRequest(`/v1/admin/wallet/${organizationId}/balance`, {
          schema: balanceSchema,
        });
        return { data, message: `Balance: R$ ${String(data.balance)}.` };
      }),
  );

  register(
    server,
    "add_credit",
    "Admin: add wallet credit through the ledger. Idempotent per externalId.",
    {
      organizationId: idSchema,
      amount: amountSchema,
      description: z.string().trim().min(1).max(255),
      externalId: z.string().trim().min(1).max(100).optional(),
    },
    idempotentWrite,
    async (input) =>
      execute(async () => {
        const externalId =
          typeof input.externalId === "string" ? input.externalId : `mcp-credit-${randomUUID()}`;
        const data = await adminRequest("/v1/admin/wallet/credit", {
          method: "POST",
          body: {
            organizationId: input.organizationId,
            amount: input.amount,
            description: input.description,
            externalId,
          },
          schema: walletMutationSchema,
          idempotencyKey: externalId,
        });
        return { data: { ...data, externalId }, message: "Credit applied through the ledger." };
      }),
  );

  register(
    server,
    "remove_credit",
    "Admin: debit wallet credit through the ledger, with a mandatory reason. Idempotent per externalId. Never leaves a negative balance unless allowNegative is explicitly true.",
    {
      organizationId: idSchema,
      amount: amountSchema,
      reason: z.string().trim().min(1).max(255),
      externalId: z.string().trim().min(1).max(100).optional(),
      allowNegative: z.boolean().default(false),
    },
    idempotentWrite,
    async (input) =>
      execute(async () => {
        const externalId =
          typeof input.externalId === "string" ? input.externalId : `mcp-debit-${randomUUID()}`;
        const data = await adminRequest("/v1/admin/wallet/debit", {
          method: "POST",
          body: {
            organizationId: input.organizationId,
            amount: input.amount,
            reason: input.reason,
            externalId,
            allowNegative: input.allowNegative === true,
          },
          schema: walletMutationSchema,
          idempotencyKey: externalId,
        });
        return { data: { ...data, externalId }, message: "Debit applied through the ledger." };
      }),
  );

  register(
    server,
    "list_transactions",
    "Wallet ledger entries for the authenticated organization, newest first.",
    {
      page: z.number().int().nonnegative().default(0),
      size: z.number().int().min(1).max(100).default(50),
    },
    readOnly,
    async (input) =>
      execute(async () => {
        const page = z
          .number()
          .int()
          .nonnegative()
          .parse(input.page ?? 0);
        const size = z
          .number()
          .int()
          .min(1)
          .max(100)
          .parse(input.size ?? 50);
        const data = await apiRequest(`/v1/wallet/transactions?page=${page}&size=${size}`, {
          schema: anyRecordSchema,
        });
        return { data, message: "Wallet transactions loaded." };
      }),
  );
};
