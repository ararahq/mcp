import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../lib/api.js";
import { AraraError } from "../lib/errors.js";
import { fakeServer, respondWith } from "./harness.js";
import { registerSendTools } from "./send.js";

vi.mock("../lib/api.js", () => ({ apiRequest: vi.fn() }));
const mockedApi = vi.mocked(apiRequest);

const accepted = {
  id: "m1",
  status: "Enviada",
  receiver: "+5511999998888",
  cost: 0.05,
  mode: "LIVE",
  sender: "+5583999999999",
};
const paged = (items: unknown[]) => ({
  data: items,
  pagination: { page: 0, size: 100, totalElements: items.length, totalPages: 1 },
});

describe("send_whatsapp", () => {
  const { server, call } = fakeServer();
  registerSendTools(server);
  beforeEach(() => mockedApi.mockReset());

  it("sends free text to a normalized phone with an idempotency key", async () => {
    respondWith(mockedApi, accepted);
    const result = await call("send_whatsapp", {
      to: "11 99999-8888",
      message: "oi",
      variables: [],
    });
    expect(result.structuredContent.ok).toBe(true);
    expect(mockedApi).toHaveBeenCalledWith(
      "/v1/messages",
      expect.objectContaining({
        method: "POST",
        body: { receiver: "+5511999998888", type: "text", body: "oi" },
        idempotencyKey: expect.any(String) as unknown as string,
      }),
    );
  });

  it("sends an approved template with positional variables", async () => {
    respondWith(mockedApi, accepted);
    await call("send_whatsapp", {
      to: "+5511999998888",
      templateName: "aviso_entrega",
      variables: ["João", "4412"],
      from: "+5583999999999",
    });
    expect(mockedApi).toHaveBeenCalledWith(
      "/v1/messages",
      expect.objectContaining({
        body: {
          sender: "+5583999999999",
          receiver: "+5511999998888",
          type: "template",
          templateName: "aviso_entrega",
          variables: ["João", "4412"],
        },
      }),
    );
  });

  it("refuses when both message and templateName are given", async () => {
    const result = await call("send_whatsapp", {
      to: "+5511999998888",
      message: "oi",
      templateName: "x",
      variables: [],
    });
    expect(result.structuredContent.error?.code).toBe("INVALID_INPUT");
    expect(mockedApi).not.toHaveBeenCalled();
  });

  it("lists approved templates when the 24h window is closed", async () => {
    mockedApi.mockRejectedValueOnce(
      new AraraError("CONVERSATION_WINDOW_CLOSED", "fechada", 422, false),
    );
    respondWith(
      mockedApi,
      paged([
        {
          id: "t1",
          name: "promo",
          category: "MARKETING",
          language: "pt_BR",
          providerStatus: "APPROVED",
          availableForSending: true,
        },
        {
          id: "t2",
          name: "orfao",
          category: "MARKETING",
          language: "pt_BR",
          providerStatus: "APPROVED",
          availableForSending: false,
        },
      ]),
    );
    const result = await call("send_whatsapp", {
      to: "+5511999998888",
      message: "oi",
      variables: [],
    });
    expect(result.structuredContent.error?.code).toBe("CONVERSATION_WINDOW_CLOSED");
    expect(result.structuredContent.error?.message).toContain("promo");
    expect(result.structuredContent.error?.message).not.toContain("orfao");
  });

  it("propagates other backend errors untouched", async () => {
    mockedApi.mockRejectedValueOnce(new AraraError("OPTED_OUT", "saiu", 422, false));
    const result = await call("send_whatsapp", {
      to: "+5511999998888",
      message: "oi",
      variables: [],
    });
    expect(result.structuredContent.error?.code).toBe("OPTED_OUT");
  });
});

describe("check_status", () => {
  const { server, call } = fakeServer();
  registerSendTools(server);
  beforeEach(() => mockedApi.mockReset());

  it("requires exactly one selector", async () => {
    const none = await call("check_status", {});
    const two = await call("check_status", { to: "+5511999998888", messageId: "m1" });
    expect(none.structuredContent.error?.code).toBe("INVALID_INPUT");
    expect(two.structuredContent.error?.code).toBe("INVALID_INPUT");
  });

  it("reports delivery for a message id", async () => {
    respondWith(mockedApi, { ...accepted, status: "Entregue" });
    const result = await call("check_status", { messageId: "m1" });
    expect(mockedApi).toHaveBeenCalledWith("/v1/messages/m1", expect.anything());
    expect(result.content[0]?.text).toContain("Entregue");
  });

  it("reports template approval with the rejection reason", async () => {
    respondWith(mockedApi, { status: "REJECTED", rejectionReason: "só variável" });
    const result = await call("check_status", {
      templateId: "2f1e0b7a-1b2c-4d3e-9f00-000000000001",
    });
    expect(result.content[0]?.text).toContain("REJECTED");
    expect(result.content[0]?.text).toContain("só variável");
  });

  it("reports an open window with hours left", async () => {
    respondWith(mockedApi, {
      results: [{ phone: "+5511999998888", isWindowOpen: true, hoursRemaining: 2.25 }],
    });
    const result = await call("check_status", { to: "+5511999998888" });
    expect(result.content[0]?.text).toContain("OPEN");
    expect(result.content[0]?.text).toContain("2.3h");
  });

  it("reports a closed window when the phone has no conversation", async () => {
    respondWith(mockedApi, { results: [] });
    const result = await call("check_status", { to: "+5511999998888" });
    expect(result.content[0]?.text).toContain("CLOSED");
  });
});
