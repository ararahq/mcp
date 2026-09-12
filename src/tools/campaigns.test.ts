import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../lib/api.js";
import { registerCampaignTools } from "./campaigns.js";
import { fakeServer, respondWith } from "./harness.js";

vi.mock("../lib/api.js", () => ({ apiRequest: vi.fn() }));
const mockedApi = vi.mocked(apiRequest);

const CAMPAIGN_ID = "9b2c1e4a-5f6d-4a7b-8c9d-0e1f2a3b4c5d";
const created = {
  id: CAMPAIGN_ID,
  name: "promo",
  status: "INGESTING",
  totalMessages: 2,
  totalCost: 0.5,
};
const templatePage = {
  data: [
    {
      id: "t1",
      name: "promo_junho",
      category: "MARKETING",
      language: "pt_BR",
      providerStatus: "APPROVED",
      availableForSending: true,
      bodyPreview: "Oi {{1}}, promo de junho",
      structureJson: {
        types: {
          "whatsapp/card": { actions: [{ title: "Ver ofertas", type: "URL", url: "https://x" }] },
        },
      },
    },
  ],
  pagination: { page: 0, size: 1, totalElements: 1, totalPages: 1 },
};
const listItem = {
  id: CAMPAIGN_ID,
  name: "promo",
  status: "COMPLETED",
  templateName: "promo_junho",
  totalMessages: 10,
  sentCount: 10,
  deliveredCount: 9,
  readCount: 4,
  failedCount: 1,
  totalCost: 3.5,
};

describe("broadcast", () => {
  const { server, call } = fakeServer();
  registerCampaignTools(server);
  beforeEach(() => mockedApi.mockReset());

  it("posts one campaign with shared and per-person variables", async () => {
    respondWith(mockedApi, created);
    respondWith(mockedApi, templatePage);
    const result = await call("broadcast", {
      templateName: "promo_junho",
      to: ["11 99999-8888", { to: "+5521977776666", variables: ["Renata"] }],
      variables: ["cliente"],
      name: "promo",
      dryRun: false,
    });
    expect(result.structuredContent.ok).toBe(true);
    expect(mockedApi).toHaveBeenCalledWith(
      "/v1/campaigns",
      expect.objectContaining({
        method: "POST",
        body: {
          name: "promo",
          templateName: "promo_junho",
          contacts: [
            { to: "+5511999998888", variables: ["cliente"] },
            { to: "+5521977776666", variables: ["Renata"] },
          ],
        },
        idempotencyKey: expect.any(String) as unknown as string,
      }),
    );
  });

  it("fills A/B defaults and the fixed 50/50 split", async () => {
    respondWith(mockedApi, created);
    respondWith(mockedApi, templatePage);
    await call("broadcast", {
      templateName: "copy_a",
      to: ["+5511999998888"],
      variables: [],
      abTest: { variantBTemplateName: "copy_b" },
      scheduledAt: "2026-09-13T12:00:00Z",
      dryRun: false,
    });
    const options = mockedApi.mock.calls[0]?.[1] as { body: Record<string, unknown> };
    expect(options.body.scheduledAt).toBe("2026-09-13T12:00:00Z");
    expect(options.body.abTest).toEqual({
      variantBTemplateName: "copy_b",
      metric: "CLICKED",
      samplePct: 20,
      decisionWindowMinutes: 240,
      autopilot: true,
      splitPct: 50,
    });
  });

  it("reports unresolved names without dropping the send", async () => {
    respondWith(mockedApi, { contacts: [], total: 0 });
    respondWith(mockedApi, created);
    respondWith(mockedApi, templatePage);
    const result = await call("broadcast", {
      templateName: "promo_junho",
      to: ["Fulano", "+5511999998888"],
      variables: [],
      dryRun: false,
    });
    expect(result.structuredContent.ok).toBe(true);
    expect(result.content[0]?.text).toContain("Fulano");
    const options = mockedApi.mock.calls[1]?.[1] as { body: { contacts: unknown[] } };
    expect(options.body.contacts).toHaveLength(1);
  });

  it("refuses when nobody resolves", async () => {
    respondWith(mockedApi, { contacts: [], total: 0 });
    const result = await call("broadcast", {
      templateName: "x",
      to: ["Fulano"],
      variables: [],
      dryRun: false,
    });
    expect(result.structuredContent.error?.code).toBe("NO_VALID_RECIPIENTS");
    expect(mockedApi).toHaveBeenCalledTimes(1);
  });
});

describe("broadcast preview", () => {
  const { server, call } = fakeServer();
  registerCampaignTools(server);
  beforeEach(() => mockedApi.mockReset());

  it("estimates and renders without posting a campaign by default", async () => {
    respondWith(mockedApi, templatePage);
    respondWith(mockedApi, {
      templateCategory: "MARKETING",
      recipientCount: 1,
      unitPrice: 0.57,
      totalCost: 0.57,
    });
    const result = await call("broadcast", {
      templateName: "promo_junho",
      to: [{ to: "+5511999998888", variables: ["Ana"] }],
      variables: [],
    });
    expect(result.structuredContent.ok).toBe(true);
    expect(result.structuredContent.data).toMatchObject({
      preview: true,
      renderedBody: "Oi Ana, promo de junho",
      buttons: ["Ver ofertas"],
      recipients: 1,
      totalCost: 0.57,
      request: { templateName: "promo_junho" },
    });
    const paths = mockedApi.mock.calls.map((call) => call[0]);
    expect(paths).not.toContain("/v1/campaigns");
    expect(paths).toContain("/v1/campaigns/estimate");
  });

  it("still previews when the template lookup fails", async () => {
    mockedApi.mockRejectedValueOnce(new Error("boom"));
    respondWith(mockedApi, {
      templateCategory: "UTILITY",
      recipientCount: 1,
      unitPrice: 0.25,
      totalCost: 0.25,
    });
    const result = await call("broadcast", {
      templateName: "x",
      to: ["+5511999998888"],
      variables: [],
    });
    expect(result.structuredContent.data).toMatchObject({
      preview: true,
      renderedBody: "",
      category: "UTILITY",
    });
  });
});

describe("campaign_report", () => {
  const { server, call } = fakeServer();
  registerCampaignTools(server);
  beforeEach(() => mockedApi.mockReset());

  it("lists recent campaigns with the status filter", async () => {
    respondWith(mockedApi, { content: [listItem], totalPages: 1, totalElements: 1 });
    const result = await call("campaign_report", { status: "COMPLETED", page: 0, size: 5 });
    expect(mockedApi).toHaveBeenCalledWith(
      "/v1/campaigns?page=0&size=5&status=COMPLETED",
      expect.anything(),
    );
    expect(result.structuredContent.data).toMatchObject({
      pagination: { page: 0, size: 5, totalElements: 1 },
    });
  });

  it("returns the full report with percentages", async () => {
    respondWith(mockedApi, {
      ...listItem,
      clickedCount: 2,
      replyCount: 3,
      convertedCount: 1,
      convertedValue: 199.9,
    });
    const result = await call("campaign_report", { campaignId: CAMPAIGN_ID, page: 0, size: 20 });
    expect(mockedApi).toHaveBeenCalledWith(`/v1/campaigns/${CAMPAIGN_ID}`, expect.anything());
    expect(result.content[0]?.text).toContain("delivered 9 (90%)");
    expect(result.content[0]?.text).toContain("replied 3");
  });
});
