import { z } from "zod";
import { AraraError } from "./errors.js";
import { jsonValueSchema, paginationSchema } from "./schemas.js";

export const AUTOMATION_TRIGGERS = [
  "webhook",
  "cart.abandoned",
  "payment.failed",
  "tag.applied",
  "conversation.started",
  "button.replied",
  "charge.paid",
  "charge.expired",
] as const;
export const AUTOMATION_STEP_TYPES = [
  "message",
  "wait",
  "condition",
  "tag",
  "question",
  "wait_payment",
] as const;
export const MAX_BRANCHING_LEVELS = 2;
const MAX_NAME = 255;
const FORBIDDEN_STATUS = 403;
const GENERIC_FORBIDDEN_CODE = "FORBIDDEN";
const PERMISSION_CODE_PATTERN = /PERMISSION|SCOPE/;

const moneySchema = z.union([z.number(), z.string()]);
const tagConfigSchema = z.object({ tag: z.string().trim().min(1) }).passthrough();
const timeoutConfigSchema = z.object({ timeoutMinutes: z.number().int().min(1) }).passthrough();
const messageConfigSchema = z.union([
  z
    .object({ templateId: z.string().uuid(), variables: z.array(z.string()).default([]) })
    .passthrough(),
  z
    .object({ sessionText: z.string().trim().min(1), chargeFromRun: z.boolean().optional() })
    .passthrough(),
]);
const questionOptionSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  match: z.array(z.string()).default([]),
});
const questionConfigSchema = timeoutConfigSchema.extend({
  mode: z.enum(["buttons", "list", "template"]),
  text: z.string().optional(),
  buttonText: z.string().optional(),
  options: z.array(questionOptionSchema).min(1),
  retryText: z.string().optional(),
  templateName: z.string().optional(),
  templateId: z.string().uuid().optional(),
  variables: z.array(z.string()).optional(),
});

export type AutomationStepInput = {
  type: (typeof AUTOMATION_STEP_TYPES)[number];
  config: Record<string, unknown>;
  branches?: Record<string, AutomationStepInput[]> | undefined;
};

const branchesSchema: z.ZodType<
  Record<string, AutomationStepInput[]>,
  z.ZodTypeDef,
  unknown
> = z.lazy(() => z.record(z.array(automationStepSchema)));

export const automationStepSchema: z.ZodType<AutomationStepInput, z.ZodTypeDef, unknown> = z.lazy(
  () =>
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("message"), config: messageConfigSchema }).strict(),
      z
        .object({
          type: z.literal("wait"),
          config: z.object({ minutes: z.number().int().min(1) }).passthrough(),
        })
        .strict(),
      z.object({ type: z.literal("condition"), config: tagConfigSchema }).strict(),
      z.object({ type: z.literal("tag"), config: tagConfigSchema }).strict(),
      z.object({
        type: z.literal("question"),
        config: questionConfigSchema,
        branches: branchesSchema.optional(),
      }),
      z.object({
        type: z.literal("wait_payment"),
        config: timeoutConfigSchema,
        branches: branchesSchema.optional(),
      }),
    ]),
);

const branchingLevels = (steps: AutomationStepInput[]): number =>
  steps.reduce((deepest, step) => {
    if (step.type !== "question" && step.type !== "wait_payment") return deepest;
    const below = Object.values(step.branches ?? {}).map(branchingLevels);
    return Math.max(deepest, 1 + Math.max(0, ...below));
  }, 0);

export const automationStepsSchema = z
  .array(automationStepSchema)
  .min(1)
  .refine((steps) => branchingLevels(steps) <= MAX_BRANCHING_LEVELS, {
    message: `At most ${MAX_BRANCHING_LEVELS} levels of branching steps (question / wait_payment).`,
  });

export const automationDefinitionShape = {
  name: z.string().trim().min(1).max(MAX_NAME),
  trigger: z.enum(AUTOMATION_TRIGGERS),
  triggerConfig: z.record(jsonValueSchema).optional(),
  steps: automationStepsSchema,
};
export const automationDefinitionSchema = z.object(automationDefinitionShape);

const hookSchema = z
  .object({ url: z.string(), signatureEnabled: z.boolean(), hasSecret: z.boolean() })
  .passthrough();
export const automationSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    trigger: z.string(),
    triggerConfig: z.record(jsonValueSchema).nullable().optional(),
    active: z.boolean(),
    steps: z.array(jsonValueSchema),
    costPerRunBrl: moneySchema,
    webhookUrl: z.string().nullable().optional(),
    hook: hookSchema.nullable().optional(),
    stats: z.record(jsonValueSchema).nullable().optional(),
  })
  .passthrough();
export const automationsSchema = z.array(automationSchema);
export const hookSignatureSchema = hookSchema.extend({ secret: z.string().nullable().optional() });
export const automationTemplateOptionsSchema = z.array(
  z
    .object({
      id: z.string(),
      name: z.string(),
      category: z.string(),
      unitPriceBrl: moneySchema,
      hasChargeButton: z.boolean().default(false),
    })
    .passthrough(),
);
export const automationPricingSchema = z.object({ sessionUnitPriceBrl: moneySchema }).passthrough();
export const automationPageSchema = z.object({
  data: z.array(z.record(jsonValueSchema)),
  pagination: paginationSchema,
});
export const emptyResponseSchema = z.unknown();

export type Automation = z.infer<typeof automationSchema>;

/**
 * The trigger URLs carry a token, so they are credentials. Every tool output goes
 * through here except get_automation, which is the one place that hands them over.
 */
export const withoutSecrets = (automation: Automation): Record<string, unknown> => {
  const { webhookUrl, hook, ...rest } = automation;
  return {
    ...rest,
    hasWebhookUrl: typeof webhookUrl === "string",
    hook:
      hook === null || hook === undefined
        ? null
        : { signatureEnabled: hook.signatureEnabled, hasSecret: hook.hasSecret },
  };
};

const isPermissionRefusal = (error: AraraError): boolean =>
  error.status === FORBIDDEN_STATUS &&
  (error.code === GENERIC_FORBIDDEN_CODE || PERMISSION_CODE_PATTERN.test(error.code));

/**
 * Turns a bare permission refusal into an instruction the user can act on. Plan
 * locks and every other coded error keep the sentence the API wrote.
 */
export const explainAutomationError = (error: unknown, permission: string): unknown => {
  if (!(error instanceof AraraError) || !isPermissionRefusal(error)) return error;
  return new AraraError(
    "AUTOMATIONS_PERMISSION_REQUIRED",
    `A chave precisa da permissão ${permission}, ligue em Configurações > Chaves de API. (API: ${error.code})`,
    FORBIDDEN_STATUS,
    false,
  );
};
