import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./api.js";
import { looksLikePhone, normalizePhone, recipientLabel, resolveRecipient } from "./recipients.js";

vi.mock("./api.js", () => ({ apiRequest: vi.fn() }));
const mockedApi = vi.mocked(apiRequest);

describe("normalizePhone", () => {
  it("keeps E.164 input untouched", () => {
    expect(normalizePhone("+5511999998888")).toBe("+5511999998888");
  });

  it("adds +55 to a bare Brazilian mobile", () => {
    expect(normalizePhone("11 99999-8888")).toBe("+5511999998888");
  });

  it("adds the ninth digit to a 10-digit Brazilian mobile with country code", () => {
    expect(normalizePhone("55 11 9999-8888")).toBe("+5511999998888");
    expect(normalizePhone("+558391768778")).toBe("+5583991768778");
  });

  it("leaves a full E.164 Brazilian mobile and a foreign number alone", () => {
    expect(normalizePhone("+5583991768778")).toBe("+5583991768778");
    expect(normalizePhone("+442079460958")).toBe("+442079460958");
  });

  it("prefixes + to any other international number", () => {
    expect(normalizePhone("44 20 7946 0958")).toBe("+442079460958");
  });
});

describe("looksLikePhone", () => {
  it("distinguishes numbers from names", () => {
    expect(looksLikePhone("+5511999998888")).toBe(true);
    expect(looksLikePhone("(11) 99999-8888")).toBe(true);
    expect(looksLikePhone("João")).toBe(false);
  });
});

describe("resolveRecipient", () => {
  beforeEach(() => mockedApi.mockReset());

  it("normalizes a phone without calling the API", async () => {
    await expect(resolveRecipient("11999998888")).resolves.toEqual({ phone: "+5511999998888" });
    expect(mockedApi).not.toHaveBeenCalled();
  });

  it("rejects a phone that cannot become E.164", async () => {
    await expect(resolveRecipient("+0000000")).rejects.toMatchObject({ code: "INVALID_PHONE" });
  });

  it("resolves a saved contact by name", async () => {
    mockedApi.mockResolvedValueOnce({
      contacts: [{ name: "Renata", phone: "+5521977776666" }],
      total: 1,
    });
    await expect(resolveRecipient("Renata")).resolves.toEqual({
      phone: "+5521977776666",
      name: "Renata",
    });
    expect(mockedApi).toHaveBeenCalledWith(
      "/v1/contacts?q=Renata&page=0&size=5",
      expect.anything(),
    );
  });

  it("fails when no contact matches the name", async () => {
    mockedApi.mockResolvedValueOnce({ contacts: [], total: 0 });
    await expect(resolveRecipient("Ninguém")).rejects.toMatchObject({ code: "CONTACT_NOT_FOUND" });
  });

  it("fails when the name is ambiguous instead of guessing", async () => {
    mockedApi.mockResolvedValueOnce({
      contacts: [
        { name: "João Silva", phone: "+5511911111111" },
        { name: "João Souza", phone: "+5511922222222" },
      ],
      total: 2,
    });
    await expect(resolveRecipient("João")).rejects.toMatchObject({ code: "CONTACT_AMBIGUOUS" });
  });
});

describe("recipientLabel", () => {
  it("shows the name when known", () => {
    expect(recipientLabel({ phone: "+55", name: "Ana" })).toBe("+55 (Ana)");
    expect(recipientLabel({ phone: "+55" })).toBe("+55");
  });
});
