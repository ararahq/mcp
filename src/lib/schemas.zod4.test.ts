import { describe, expect, it } from "vitest";
import { automationStepsSchema } from "./automations.js";
import { balanceSchema, jsonValueSchema } from "./schemas.js";

describe("record schemas on zod 4", () => {
  it("should accept nested json objects with arbitrary string keys", () => {
    const value = { a: 1, b: { c: [true, null, "x"] } };

    expect(jsonValueSchema.parse(value)).toEqual(value);
    expect(balanceSchema.parse({ credits: 10, currency: "BRL" })).toEqual({
      credits: 10,
      currency: "BRL",
    });
  });

  it("should reject a record value that is not json", () => {
    expect(balanceSchema.safeParse({ fn: () => 1 }).success).toBe(false);
  });

  it("should parse question branches keyed by option id", () => {
    const steps = [
      {
        type: "question",
        config: { timeoutMinutes: 60, mode: "buttons", options: [{ id: "sim", title: "Sim" }] },
        branches: { sim: [{ type: "wait", config: { minutes: 5 } }] },
      },
    ];

    const parsed = automationStepsSchema.parse(steps);

    expect(parsed[0]?.branches?.["sim"]?.[0]?.type).toBe("wait");
  });
});
