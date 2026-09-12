import axios from "axios";
import { describe, expect, it } from "vitest";
import { toAraraError } from "./errors.js";

describe("error normalization", () => {
  it("preserves the backend error contract and Retry-After", () => {
    const response = {
      status: 429,
      data: { error: { code: "RATE_LIMITED", message: "Wait." } },
      headers: { "retry-after": "7" },
      statusText: "Too Many Requests",
      config: {},
    };
    const normalized = toAraraError(
      new axios.AxiosError("limited", "ERR_BAD_RESPONSE", undefined, undefined, response as never),
    );
    expect(normalized).toMatchObject({
      code: "RATE_LIMITED",
      message: "Wait.",
      retryable: true,
      retryAfterSeconds: 7,
    });
  });

  it("maps a bare Spring 404 to NOT_FOUND instead of a generic upstream error", () => {
    const response = {
      status: 404,
      data: { timestamp: "now", status: 404, error: "Not Found", path: "/x" },
      headers: {},
      statusText: "Not Found",
      config: {},
    };
    const normalized = toAraraError(
      new axios.AxiosError("missing", "ERR_BAD_REQUEST", undefined, undefined, response as never),
    );
    expect(normalized).toMatchObject({ code: "NOT_FOUND", status: 404, retryable: false });
  });

  it("does not leak arbitrary internal errors", () => {
    const normalized = toAraraError(new Error("secret details"));
    expect(normalized.message).not.toContain("secret details");
  });
});
