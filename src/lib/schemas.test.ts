import { describe, expect, it } from "vitest";
import {
  campaignDetailSchema,
  campaignListSchema,
  numbersSchema,
  pagedTemplatesSchema,
  windowStatusSchema,
} from "./schemas.js";

const template = {
  id: "t1",
  name: "hello",
  category: "UTILITY",
  language: "pt_BR",
  providerStatus: "APPROVED",
  availableForSending: true,
};

describe("API contracts", () => {
  it("accepts the real numbers envelope", () => {
    expect(numbersSchema.safeParse({ numbers: [{ id: "n1" }], slot: null }).success).toBe(true);
  });

  it("unwraps the paginated templates envelope into a plain list", () => {
    const parsed = pagedTemplatesSchema.parse({
      data: [template],
      pagination: { page: 0, size: 50, totalElements: 1, totalPages: 1 },
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.availableForSending).toBe(true);
  });

  it("rejects a bare template array now that the backend paginates", () => {
    expect(pagedTemplatesSchema.safeParse([template]).success).toBe(false);
  });

  it("normalizes the campaign list into the MCP pagination contract", () => {
    const parsed = campaignListSchema.parse({
      content: [
        {
          id: "c1",
          name: "promo",
          status: "COMPLETED",
          templateName: "promo_junho",
          totalMessages: 10,
          sentCount: 10,
          deliveredCount: 9,
          readCount: 4,
          failedCount: 1,
          totalCost: 3.5,
          scheduledAt: null,
          createdAt: "2026-09-01T00:00:00Z",
        },
      ],
      totalPages: 1,
      totalElements: 1,
    });
    expect(parsed.data[0]?.templateName).toBe("promo_junho");
    expect(parsed.pagination).toEqual({ totalPages: 1, totalElements: 1 });
  });

  it("defaults the optional campaign detail counters", () => {
    const parsed = campaignDetailSchema.parse({
      id: "c1",
      name: "promo",
      status: "COMPLETED",
      templateName: "promo_junho",
      totalMessages: 10,
      sentCount: 10,
      deliveredCount: 9,
      readCount: 4,
      failedCount: 1,
      clickedCount: 2,
      convertedCount: 1,
      convertedValue: 199.9,
      totalCost: 3.5,
    });
    expect(parsed.replyCount).toBe(0);
    expect(parsed.blockReasons).toEqual([]);
  });

  it("reads the window status results list", () => {
    const parsed = windowStatusSchema.parse({
      results: [{ phone: "+5511999999999", isWindowOpen: true, hoursRemaining: 3.5 }],
    });
    expect(parsed.results[0]?.isWindowOpen).toBe(true);
  });
});
