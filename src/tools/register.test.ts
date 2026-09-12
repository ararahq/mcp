import { describe, expect, it } from "vitest";
import { AraraError } from "../lib/errors.js";
import { fakeServer } from "./harness.js";
import { readOnly, register } from "./register.js";

describe("register", () => {
  it("runs the gate before the handler and returns the failure envelope", async () => {
    const { server, call } = fakeServer();
    let handlerCalls = 0;
    register(
      server,
      "gated",
      "gated tool",
      {},
      readOnly,
      () => {
        handlerCalls += 1;
        return Promise.resolve({ content: [], structuredContent: { ok: true } });
      },
      {
        gate: () => Promise.reject(new AraraError("OPERATOR_FORBIDDEN", "not allowed", 403, false)),
      },
    );
    const result = await call("gated");
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error?.code).toBe("OPERATOR_FORBIDDEN");
    expect(handlerCalls).toBe(0);
  });

  it("calls the handler when the gate passes", async () => {
    const { server, call } = fakeServer();
    register(
      server,
      "open",
      "open tool",
      {},
      readOnly,
      () => Promise.resolve({ content: [], structuredContent: { ok: true } }),
      { gate: () => Promise.resolve(), ui: "ui://arara/test.html" },
    );
    const result = await call("open");
    expect(result.structuredContent.ok).toBe(true);
  });
});
