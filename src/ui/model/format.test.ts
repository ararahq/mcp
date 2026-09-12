import { describe, expect, it } from "vitest";
import {
  buildFunnel,
  humanizeCampaignStatus,
  isCampaignRunning,
  progressPercent,
} from "./campaign.js";
import { readEnvelope } from "./envelope.js";
import { formatBrl, formatInteger, percentOf, renderTemplateBody } from "./format.js";
import { buildTimeline, humanizeMessageStatus, isTerminalStatus } from "./status.js";

describe("format", () => {
  it("formats currency and integers in pt-BR", () => {
    expect(formatBrl(1234.5)).toMatch(/R\$\s?1\.234,50/);
    expect(formatInteger(1240)).toBe("1.240");
    expect(formatBrl(Number.NaN)).toMatch(/0,00/);
  });

  it("rounds percentages and guards division by zero", () => {
    expect(percentOf(30, 37)).toBe(81);
    expect(percentOf(1, 0)).toBe(0);
  });

  it("renders positional template variables and keeps missing ones visible", () => {
    expect(renderTemplateBody("Oi {{1}}, pedido {{2}}", ["Ana"])).toBe("Oi Ana, pedido {{2}}");
  });
});

describe("campaign model", () => {
  const counts = {
    totalMessages: 100,
    sentCount: 90,
    deliveredCount: 80,
    readCount: 40,
    clickedCount: 10,
    replyCount: 5,
    convertedCount: 1,
    failedCount: 10,
  };

  it("builds the funnel in order with percentages of the audience", () => {
    const funnel = buildFunnel(counts);
    expect(funnel.map((step) => step.key)).toEqual([
      "sent",
      "delivered",
      "read",
      "clicked",
      "replied",
      "converted",
    ]);
    expect(funnel[2]).toMatchObject({ label: "Lidas", count: 40, percent: 40 });
  });

  it("skips funnel rows the list endpoint does not provide", () => {
    const funnel = buildFunnel({
      totalMessages: 10,
      sentCount: 5,
      deliveredCount: 4,
      readCount: 2,
    });
    expect(funnel).toHaveLength(3);
  });

  it("knows which statuses are still running and humanizes them", () => {
    expect(isCampaignRunning("SENDING")).toBe(true);
    expect(isCampaignRunning("completed")).toBe(false);
    expect(humanizeCampaignStatus("AB_TESTING")).toBe("Teste A/B");
    expect(humanizeCampaignStatus("WEIRD")).toBe("WEIRD");
    expect(progressPercent(counts)).toBe(100);
  });
});

describe("status timeline", () => {
  it("marks steps up to the current status", () => {
    const states = buildTimeline("DELIVERED").map((step) => step.state);
    expect(states).toEqual(["done", "done", "current", "pending"]);
    expect(buildTimeline("READ").every((step) => step.state === "done")).toBe(true);
  });

  it("marks the send step as failed on provider failure", () => {
    const states = buildTimeline("FAILED").map((step) => step.state);
    expect(states).toEqual(["done", "failed", "pending", "pending"]);
    expect(isTerminalStatus("FAILED")).toBe(true);
    expect(isTerminalStatus("PENDING")).toBe(false);
  });

  it("humanizes provider statuses in Portuguese", () => {
    expect(humanizeMessageStatus("SENT_TO_PROVIDER")).toBe("Enviada");
    expect(humanizeMessageStatus("Entregue")).toBe("Entregue");
    expect(humanizeMessageStatus("FAILED")).toBe("Falhou");
  });
});

describe("envelope", () => {
  it("reads success and failure envelopes", () => {
    expect(readEnvelope({ ok: true, data: { a: 1 } })).toEqual({ ok: true, data: { a: 1 } });
    const failure = readEnvelope({
      ok: false,
      error: { code: "X", message: "m", retryable: true },
    });
    expect(failure).toMatchObject({ ok: false, error: { code: "X", retryable: true } });
    expect(readEnvelope(null)).toMatchObject({ ok: false, error: { code: "EMPTY_RESULT" } });
  });
});
