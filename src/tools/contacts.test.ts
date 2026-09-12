import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../lib/api.js";
import { registerContactTools } from "./contacts.js";
import { fakeServer, respondWith } from "./harness.js";

vi.mock("../lib/api.js", () => ({ apiRequest: vi.fn() }));
const mockedApi = vi.mocked(apiRequest);

describe("contact tools", () => {
  const { server, call } = fakeServer();
  registerContactTools(server);
  beforeEach(() => mockedApi.mockReset());

  it("saves a batch and surfaces row errors", async () => {
    respondWith(mockedApi, {
      created: 1,
      updated: 0,
      skipped: 1,
      errors: [{ index: 1, phone: "+55", reason: "invalid" }],
    });
    const result = await call("save_contacts", {
      contacts: [{ name: "Ana", phone: "+5511999998888" }],
    });
    expect(mockedApi).toHaveBeenCalledWith(
      "/v1/contacts/batch",
      expect.objectContaining({ method: "POST", retry: false }),
    );
    expect(result.content[0]?.text).toContain("1 created");
    expect(result.content[0]?.text).toContain("#1 +55 invalid");
  });

  it("records an opt-out with its reason", async () => {
    respondWith(mockedApi, { phone: "+5511999998888", channel: "WHATSAPP" });
    const result = await call("opt_out", { phone: "+5511999998888", reason: "respondeu PARAR" });
    expect(mockedApi).toHaveBeenCalledWith(
      "/v1/opt-outs",
      expect.objectContaining({ body: { phone: "+5511999998888", reason: "respondeu PARAR" } }),
    );
    expect(result.structuredContent.ok).toBe(true);
  });

  it("reads a conversation and counts inbound messages", async () => {
    respondWith(mockedApi, {
      phone: "+5511999998888",
      total: 2,
      messages: [
        { direction: "INBOUND", status: "read", body: "quero", createdAt: "2026-09-12T10:00:00Z" },
        {
          direction: "OUTBOUND",
          status: "read",
          templateName: "promo",
          createdAt: "2026-09-12T09:00:00Z",
        },
      ],
    });
    const result = await call("read_conversation", { to: "11999998888", limit: 30 });
    expect(mockedApi).toHaveBeenCalledWith(
      "/v1/contacts/+5511999998888/messages?limit=30",
      expect.anything(),
    );
    expect(result.content[0]?.text).toContain("1 from the customer");
  });
});
