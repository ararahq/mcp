import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../lib/api.js";
import { AraraError } from "../lib/errors.js";
import { AUTOMATION_TOOL_NAMES, registerAutomationTools } from "./automations.js";
import { fakeServer, respondWith } from "./harness.js";

vi.mock("../lib/api.js", () => ({ apiRequest: vi.fn() }));
const mockedApi = vi.mocked(apiRequest);

const ID = "2f1e0b7a-1b2c-4d3e-9f00-000000000001";
const RUN_ID = "2f1e0b7a-1b2c-4d3e-9f00-000000000002";
const HOOK_URL = "https://api.ararahq.com/v1/automation-hooks/tok_hook";
const WEBHOOK_URL = "https://api.ararahq.com/webhooks/recovery/tok_recovery";
const SIGNING_SECRET = "whsec_shown_once";

const automation = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  name: "Carrinho",
  trigger: "webhook",
  triggerConfig: null,
  active: false,
  steps: [{ type: "wait", config: { minutes: 30 } }],
  costPerRunBrl: 0.42,
  webhookUrl: WEBHOOK_URL,
  hook: { url: HOOK_URL, signatureEnabled: false, hasSecret: false },
  stats: { runsLast30Days: 3, inFlight: 1, completed: 2, stopped: 0 },
  ...overrides,
});

const branchingFlow = {
  name: "Carrinho",
  trigger: "cart.abandoned",
  steps: [
    {
      type: "question",
      config: {
        mode: "template",
        templateName: "carrinho_lembrete",
        text: "Ainda quer?",
        options: [
          { id: "sim", title: "Quero", match: ["sim"] },
          { id: "nao", title: "Agora nao", match: ["nao"] },
        ],
        timeoutMinutes: 1440,
      },
      branches: {
        sim: [{ type: "message", config: { sessionText: "Segue o link" } }],
        nao: [{ type: "tag", config: { tag: "sem-interesse" } }],
      },
    },
  ],
};

const { server, call, tools } = fakeServer();
registerAutomationTools(server);
beforeEach(() => mockedApi.mockReset());

const serialized = (value: unknown): string => JSON.stringify(value);

describe("registerAutomationTools", () => {
  it("registers exactly the published automation tools", () => {
    expect([...tools.keys()].sort()).toEqual([...AUTOMATION_TOOL_NAMES].sort());
  });
});

describe("list_automations", () => {
  it("lists automations without any trigger url", async () => {
    respondWith(mockedApi, [automation(), automation({ active: true, hook: null })]);
    const result = await call("list_automations");
    expect(mockedApi).toHaveBeenCalledWith("/v1/automations", expect.anything());
    expect(result.content[0]?.text).toBe("2 automation(s), 1 active.");
    expect(serialized(result)).not.toContain("tok_");
    expect(result.structuredContent.data).toMatchObject([
      { hasWebhookUrl: true, hook: { signatureEnabled: false, hasSecret: false } },
      { hook: null },
    ]);
  });

  it("explains a missing READ permission", async () => {
    mockedApi.mockRejectedValueOnce(new AraraError("FORBIDDEN", "denied", 403, false));
    const result = await call("list_automations");
    expect(result.structuredContent.error?.code).toBe("AUTOMATIONS_PERMISSION_REQUIRED");
    expect(result.structuredContent.error?.message).toContain("permissão READ");
  });

  it("keeps the plan lock sentence from the api", async () => {
    mockedApi.mockRejectedValueOnce(
      new AraraError("PLAN_FEATURE_LOCKED", "Disponível no Voo Solo", 403, false),
    );
    const result = await call("list_automations");
    expect(result.structuredContent.error).toMatchObject({
      code: "PLAN_FEATURE_LOCKED",
      message: "Disponível no Voo Solo",
    });
  });
});

describe("get_automation", () => {
  it("is the one read that hands over the trigger urls, flagged as secrets", async () => {
    respondWith(mockedApi, automation());
    const result = await call("get_automation", { automationId: ID });
    expect(mockedApi).toHaveBeenCalledWith(`/v1/automations/${ID}`, expect.anything());
    expect(result.structuredContent.data).toMatchObject({ hook: { url: HOOK_URL } });
    expect(result.content[0]?.text).toContain("secrets");
    expect(result.content[0]?.text).not.toContain("tok_");
  });

  it("rejects an id that is not a uuid before calling the api", async () => {
    const result = await call("get_automation", { automationId: "abc" });
    expect(result.structuredContent.error?.code).toBe("INVALID_INPUT");
    expect(mockedApi).not.toHaveBeenCalled();
  });
});

describe("list_automation_templates", () => {
  it("joins approved templates with the session price", async () => {
    respondWith(mockedApi, [
      { id: ID, name: "cobranca", category: "UTILITY", unitPriceBrl: 0.08, hasChargeButton: true },
    ]);
    respondWith(mockedApi, { sessionUnitPriceBrl: 0.02 });
    const result = await call("list_automation_templates");
    expect(result.structuredContent.data).toMatchObject({
      templates: [{ name: "cobranca", hasChargeButton: true }],
      sessionUnitPriceBrl: 0.02,
    });
  });
});

describe("create_automation", () => {
  it("posts the branching flow and never activates", async () => {
    respondWith(mockedApi, automation({ trigger: "cart.abandoned" }));
    const result = await call("create_automation", { ...branchingFlow, active: true });
    expect(mockedApi).toHaveBeenCalledTimes(1);
    const [path, options] = mockedApi.mock.calls[0] ?? [];
    expect(path).toBe("/v1/automations");
    expect(options).toMatchObject({ method: "POST", retry: false });
    expect(options?.body).not.toHaveProperty("active");
    expect(options?.body).toMatchObject({
      trigger: "cart.abandoned",
      steps: [{ type: "question", branches: { sim: [{ type: "message" }] } }],
    });
    expect(result.content[0]?.text).toContain("INACTIVE");
    expect(serialized(result)).not.toContain("tok_");
  });

  it("rejects a bad payload with the path of the problem and no api call", async () => {
    const result = await call("create_automation", {
      name: "X",
      trigger: "CART_ABANDONED",
      steps: [{ type: "wait", config: {} }],
    });
    expect(result.structuredContent.error?.code).toBe("INVALID_INPUT");
    expect(result.structuredContent.error?.message).toContain("trigger");
    expect(mockedApi).not.toHaveBeenCalled();
  });

  it("passes the human sentence of a validation error through", async () => {
    mockedApi.mockRejectedValueOnce(
      new AraraError(
        "AUTOMATION_STEP_INVALID",
        "Esse tipo de pergunta aceita até 3 opções",
        400,
        false,
      ),
    );
    const result = await call("create_automation", branchingFlow);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      "AUTOMATION_STEP_INVALID: Esse tipo de pergunta aceita até 3 opções",
    );
  });

  it("explains a missing AUTOMATIONS_MANAGE permission", async () => {
    mockedApi.mockRejectedValueOnce(new AraraError("FORBIDDEN", "denied", 403, false));
    const result = await call("create_automation", branchingFlow);
    expect(result.structuredContent.error?.message).toContain(
      "A chave precisa da permissão AUTOMATIONS_MANAGE, ligue em Configurações > Chaves de API",
    );
  });
});

describe("update_automation", () => {
  it("puts the full definition without the id in the body", async () => {
    respondWith(mockedApi, automation({ active: true }));
    const result = await call("update_automation", { automationId: ID, ...branchingFlow });
    const [path, options] = mockedApi.mock.calls[0] ?? [];
    expect(path).toBe(`/v1/automations/${ID}`);
    expect(options).toMatchObject({ method: "PUT" });
    expect(options?.body).not.toHaveProperty("automationId");
    expect(options?.body).not.toHaveProperty("active");
    expect(result.content[0]?.text).toContain("[active]");
    expect(serialized(result)).not.toContain("tok_");
  });

  it("passes AUTOMATION_TRIGGER_CONFIG_INVALID through", async () => {
    mockedApi.mockRejectedValueOnce(
      new AraraError("AUTOMATION_TRIGGER_CONFIG_INVALID", "Diga qual etiqueta dispara", 400, false),
    );
    const result = await call("update_automation", { automationId: ID, ...branchingFlow });
    expect(result.structuredContent.error?.message).toBe("Diga qual etiqueta dispara");
  });
});

describe("set_automation_active", () => {
  it("previews the activation by default and changes nothing", async () => {
    respondWith(mockedApi, automation());
    const result = await call("set_automation_active", { automationId: ID, active: true });
    expect(mockedApi).toHaveBeenCalledTimes(1);
    expect(mockedApi.mock.calls[0]?.[1]).not.toHaveProperty("method");
    expect(result.structuredContent.data).toMatchObject({ preview: true });
    expect(result.content[0]?.text).toContain("dryRun=false");
    expect(serialized(result)).not.toContain("tok_");
  });

  it("activates only with dryRun=false", async () => {
    respondWith(mockedApi, automation({ active: true }));
    const result = await call("set_automation_active", {
      automationId: ID,
      active: true,
      dryRun: false,
    });
    expect(mockedApi).toHaveBeenCalledWith(
      `/v1/automations/${ID}/active`,
      expect.objectContaining({ method: "PUT", body: { active: true } }),
    );
    expect(result.content[0]?.text).toContain("ACTIVE");
  });

  it("turns off immediately, without a dry run", async () => {
    respondWith(mockedApi, automation({ active: false }));
    await call("set_automation_active", { automationId: ID, active: false });
    expect(mockedApi).toHaveBeenCalledWith(
      `/v1/automations/${ID}/active`,
      expect.objectContaining({ body: { active: false } }),
    );
  });

  it("rejects a non boolean active", async () => {
    const result = await call("set_automation_active", { automationId: ID, active: "yes" });
    expect(result.structuredContent.error?.code).toBe("INVALID_INPUT");
    expect(mockedApi).not.toHaveBeenCalled();
  });

  it("explains a missing permission on activation", async () => {
    mockedApi.mockRejectedValueOnce(new AraraError("FORBIDDEN", "denied", 403, false));
    const result = await call("set_automation_active", {
      automationId: ID,
      active: true,
      dryRun: false,
    });
    expect(result.structuredContent.error?.code).toBe("AUTOMATIONS_PERMISSION_REQUIRED");
  });
});

describe("delete_automation", () => {
  it("previews by default and never sends DELETE", async () => {
    respondWith(mockedApi, automation({ active: true }));
    const result = await call("delete_automation", { automationId: ID });
    expect(mockedApi).toHaveBeenCalledTimes(1);
    expect(mockedApi.mock.calls[0]?.[1]).not.toHaveProperty("method");
    expect(result.content[0]?.text).toContain("nothing deleted");
    expect(serialized(result)).not.toContain("tok_");
  });

  it("deletes with dryRun=false", async () => {
    respondWith(mockedApi, "");
    const result = await call("delete_automation", { automationId: ID, dryRun: false });
    expect(mockedApi).toHaveBeenCalledWith(
      `/v1/automations/${ID}`,
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(result.structuredContent.data).toEqual({ deleted: true, automationId: ID });
  });

  it("passes a not found through", async () => {
    mockedApi.mockRejectedValueOnce(
      new AraraError("NOT_FOUND", "Automação não encontrada", 404, false),
    );
    const result = await call("delete_automation", { automationId: ID, dryRun: false });
    expect(result.structuredContent.error?.message).toBe("Automação não encontrada");
  });
});

describe("list_automation_runs", () => {
  const page = (data: unknown[]) => ({
    data,
    pagination: { page: 0, size: 20, totalElements: data.length, totalPages: 1 },
  });

  it("lists runs with the default page size", async () => {
    respondWith(
      mockedApi,
      page([{ id: RUN_ID, phoneNumber: "+5588999999999", status: "STOPPED" }]),
    );
    const result = await call("list_automation_runs", { automationId: ID });
    expect(mockedApi).toHaveBeenCalledWith(
      `/v1/automations/${ID}/runs?page=0&size=20`,
      expect.anything(),
    );
    expect(result.content[0]?.text).toContain("1 run(s)");
  });

  it("returns the event trail when a run id is given", async () => {
    respondWith(mockedApi, page([{ id: "e1", kind: "MESSAGE_SENT", detail: null }]));
    const result = await call("list_automation_runs", { automationId: ID, runId: RUN_ID, page: 1 });
    expect(mockedApi).toHaveBeenCalledWith(
      `/v1/automations/${ID}/runs/${RUN_ID}/events?page=1&size=50`,
      expect.anything(),
    );
    expect(result.content[0]?.text).toContain("1 event(s)");
  });

  it("rejects an oversized page", async () => {
    const result = await call("list_automation_runs", { automationId: ID, size: 1000 });
    expect(result.structuredContent.error?.code).toBe("INVALID_INPUT");
    expect(mockedApi).not.toHaveBeenCalled();
  });
});

describe("manage_automation_hook", () => {
  it("previews by default without touching the api", async () => {
    const result = await call("manage_automation_hook", {
      automationId: ID,
      action: "regenerate_url",
    });
    expect(mockedApi).not.toHaveBeenCalled();
    expect(result.structuredContent.data).toMatchObject({ preview: true });
  });

  it("regenerates without echoing the new url", async () => {
    respondWith(mockedApi, { url: HOOK_URL, signatureEnabled: false, hasSecret: false });
    const result = await call("manage_automation_hook", {
      automationId: ID,
      action: "regenerate_url",
      dryRun: false,
    });
    expect(mockedApi).toHaveBeenCalledWith(
      `/v1/automations/${ID}/hook/regenerate`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(serialized(result)).not.toContain("tok_");
  });

  it("returns the signing secret once when enabling, outside the text content", async () => {
    respondWith(mockedApi, {
      url: HOOK_URL,
      signatureEnabled: true,
      hasSecret: true,
      secret: SIGNING_SECRET,
    });
    const result = await call("manage_automation_hook", {
      automationId: ID,
      action: "enable_signature",
      dryRun: false,
    });
    expect(mockedApi).toHaveBeenCalledWith(
      `/v1/automations/${ID}/hook/signature`,
      expect.objectContaining({ method: "PUT", body: { enabled: true } }),
    );
    expect(result.structuredContent.data).toEqual({
      signatureEnabled: true,
      hasSecret: true,
      secret: SIGNING_SECRET,
    });
    expect(result.content[0]?.text).toContain("SHOWN ONCE");
    expect(result.content[0]?.text).not.toContain(SIGNING_SECRET);
  });

  it("never returns a secret or url when disabling", async () => {
    respondWith(mockedApi, {
      url: HOOK_URL,
      signatureEnabled: false,
      hasSecret: false,
      secret: SIGNING_SECRET,
    });
    const result = await call("manage_automation_hook", {
      automationId: ID,
      action: "disable_signature",
      dryRun: false,
    });
    expect(serialized(result)).not.toContain(SIGNING_SECRET);
    expect(serialized(result)).not.toContain("tok_");
  });

  it("rejects an unknown action", async () => {
    const result = await call("manage_automation_hook", { automationId: ID, action: "rotate" });
    expect(result.structuredContent.error?.code).toBe("INVALID_INPUT");
  });
});
