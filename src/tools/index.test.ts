import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../lib/api.js";
import { fakeServer, respondWith } from "./harness.js";
import { registerAllTools, TOOL_NAMES } from "./index.js";
import { registerTemplateTools } from "./templates.js";

vi.mock("../lib/api.js", () => ({ apiRequest: vi.fn() }));
const mockedApi = vi.mocked(apiRequest);

describe("registerAllTools", () => {
  it("registers exactly the published tool names", () => {
    const { server, tools } = fakeServer();
    registerAllTools(server);
    expect([...tools.keys()].sort()).toEqual([...TOOL_NAMES].sort());
  });
});

describe("whoami", () => {
  const { server, call } = fakeServer();
  registerAllTools(server);
  beforeEach(() => mockedApi.mockReset());

  it("combines identity, plan and balance", async () => {
    respondWith(mockedApi, { name: "Micael", email: "micael@ararahq.com" });
    respondWith(mockedApi, { current: "VOO" });
    respondWith(mockedApi, { balance: 120.5 });
    const result = await call("whoami");
    expect(result.content[0]?.text).toContain("plan VOO");
    expect(result.structuredContent.data).toMatchObject({ balance: { balance: 120.5 } });
  });
});

describe("create_template", () => {
  const { server, call } = fakeServer();
  registerTemplateTools(server);
  beforeEach(() => mockedApi.mockReset());

  it("submits header, footer, samples and buttons", async () => {
    respondWith(mockedApi, {
      id: "2f1e0b7a-1b2c-4d3e-9f00-000000000001",
      name: "aviso_entrega",
      category: "UTILITY",
      language: "pt_BR",
      providerStatus: "PENDING",
      availableForSending: false,
    });
    const result = await call("create_template", {
      name: "aviso_entrega",
      category: "UTILITY",
      body: "Oi {{1}}, seu pedido {{2}} saiu",
      language: "pt_BR",
      header: "Loja da Marina",
      footer: "Responda PARAR para sair",
      samples: { "1": "João", "2": "4412" },
      buttons: [{ type: "SMART_LINK", text: "Falar", url: "https://wa.me/5583991768778" }],
    });
    expect(mockedApi).toHaveBeenCalledWith(
      "/v1/templates",
      expect.objectContaining({
        method: "POST",
        retry: false,
        body: expect.objectContaining({ header: "Loja da Marina", headerType: "text" }) as unknown,
      }),
    );
    expect(result.content[0]?.text).toContain("PENDING");
    expect(result.content[0]?.text).toContain("check_status");
  });
});

describe("create_template minimal payloads", () => {
  const { server, call } = fakeServer();
  registerTemplateTools(server);
  beforeEach(() => mockedApi.mockReset());

  const submitted = {
    id: "2f1e0b7a-1b2c-4d3e-9f00-000000000002",
    name: "promo",
    category: "MARKETING",
    language: "pt_BR",
    providerStatus: "PENDING",
    availableForSending: false,
  };

  it("omits header, footer, samples and buttons when not given", async () => {
    respondWith(mockedApi, submitted);
    await call("create_template", {
      name: "promo",
      category: "MARKETING",
      body: "Promo de setembro para {{1}}",
      language: "pt_BR",
    });
    const options = mockedApi.mock.calls[0]?.[1] as { body: Record<string, unknown> };
    expect(Object.keys(options.body).sort()).toEqual(["body", "category", "language", "name"]);
  });

  it("keeps an explicit media header type", async () => {
    respondWith(mockedApi, submitted);
    await call("create_template", {
      name: "promo",
      category: "MARKETING",
      body: "Promo de setembro para {{1}}",
      language: "pt_BR",
      header: "https://cdn.ararahq.com/banner.png",
      headerType: "media",
    });
    const options = mockedApi.mock.calls[0]?.[1] as { body: Record<string, unknown> };
    expect(options.body.headerType).toBe("media");
  });
});
