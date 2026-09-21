import { describe, expect, it } from "vitest";
import {
  automationDefinitionSchema,
  automationSchema,
  explainAutomationError,
  withoutSecrets,
  type AutomationStepInput,
} from "./automations.js";
import { AraraError } from "./errors.js";

const question = (branches: Record<string, AutomationStepInput[]>): AutomationStepInput => ({
  type: "question",
  config: {
    mode: "buttons",
    text: "Quer?",
    options: [{ id: "sim", title: "Sim", match: ["sim"] }],
    timeoutMinutes: 60,
  },
  branches,
});
const definition = (steps: unknown[]) => ({ name: "Fluxo", trigger: "webhook", steps });

describe("automationDefinitionSchema", () => {
  it("accepts a branching flow with two levels", () => {
    const parsed = automationDefinitionSchema.safeParse(
      definition([
        question({
          sim: [{ type: "wait_payment", config: { timeoutMinutes: 30 } }],
          __timeout: [],
        }),
      ]),
    );
    expect(parsed.success).toBe(true);
  });

  it("rejects a third level of branching", () => {
    const parsed = automationDefinitionSchema.safeParse(
      definition([question({ sim: [question({ sim: [question({})] })] })]),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects uppercase wire values and unknown step types", () => {
    expect(
      automationDefinitionSchema.safeParse({ ...definition([]), trigger: "WEBHOOK" }).success,
    ).toBe(false);
    expect(
      automationDefinitionSchema.safeParse(definition([{ type: "MESSAGE", config: {} }])).success,
    ).toBe(false);
  });

  it("requires a message step to carry a template or a session text", () => {
    expect(
      automationDefinitionSchema.safeParse(definition([{ type: "message", config: {} }])).success,
    ).toBe(false);
    expect(
      automationDefinitionSchema.safeParse(
        definition([{ type: "message", config: { sessionText: "Oi", chargeFromRun: true } }]),
      ).success,
    ).toBe(true);
  });

  it("refuses branches on a step that does not branch", () => {
    const parsed = automationDefinitionSchema.safeParse(
      definition([{ type: "wait", config: { minutes: 5 }, branches: {} }]),
    );
    expect(parsed.success).toBe(false);
  });
});

describe("withoutSecrets", () => {
  it("drops the trigger urls and keeps only hook flags", () => {
    const automation = automationSchema.parse({
      id: "a",
      name: "Fluxo",
      trigger: "webhook",
      active: false,
      steps: [],
      costPerRunBrl: 0.5,
      webhookUrl: "https://api.ararahq.com/r/tok_1",
      hook: { url: "https://api.ararahq.com/h/tok_2", signatureEnabled: true, hasSecret: true },
    });
    const safe = withoutSecrets(automation);
    expect(JSON.stringify(safe)).not.toContain("tok_");
    expect(safe).toMatchObject({
      hasWebhookUrl: true,
      hook: { signatureEnabled: true, hasSecret: true },
    });
  });

  it("keeps a null hook as null", () => {
    const automation = automationSchema.parse({
      id: "a",
      name: "Fluxo",
      trigger: "tag.applied",
      active: true,
      steps: [],
      costPerRunBrl: "0.10",
      hook: null,
    });
    expect(withoutSecrets(automation)).toMatchObject({ hasWebhookUrl: false, hook: null });
  });
});

describe("explainAutomationError", () => {
  it("rewrites a bare 403 into the permission instruction", () => {
    const explained = explainAutomationError(
      new AraraError("FORBIDDEN", "API Key permission denied", 403, false),
      "AUTOMATIONS_MANAGE",
    ) as AraraError;
    expect(explained.code).toBe("AUTOMATIONS_PERMISSION_REQUIRED");
    expect(explained.message).toContain("permissão AUTOMATIONS_MANAGE");
    expect(explained.message).toContain("Configurações > Chaves de API");
  });

  it("rewrites a coded permission refusal too", () => {
    const explained = explainAutomationError(
      new AraraError("API_KEY_PERMISSION_DENIED", "no", 403, false),
      "READ",
    ) as AraraError;
    expect(explained.message).toContain("permissão READ");
  });

  it("keeps plan locks, validation errors and unknown errors untouched", () => {
    const locked = new AraraError("PLAN_FEATURE_LOCKED", "Disponível no Voo", 403, false);
    const invalid = new AraraError("AUTOMATION_STEP_INVALID", "Falta o template", 400, false);
    const boom = new Error("boom");
    expect(explainAutomationError(locked, "READ")).toBe(locked);
    expect(explainAutomationError(invalid, "READ")).toBe(invalid);
    expect(explainAutomationError(boom, "READ")).toBe(boom);
  });
});
