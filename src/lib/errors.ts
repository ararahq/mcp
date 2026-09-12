import axios from "axios";

export class AraraError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AraraError";
  }
}

const DEFAULT_CODES: Record<number, string> = {
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  429: "RATE_LIMITED",
};
const DEFAULT_MESSAGES: Record<number, string> = {
  401: "OAuth authentication is required or has expired.",
  403: "This account is not allowed to do that.",
  404: "The requested resource does not exist in this organization.",
};

const parseRetryAfter = (value: unknown): number | undefined => {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - Date.now()) / 1_000));
};

export const toAraraError = (error: unknown): AraraError => {
  if (error instanceof AraraError) return error;
  if (!axios.isAxiosError(error)) {
    return new AraraError(
      "INTERNAL_ERROR",
      "The MCP server could not complete the request.",
      500,
      false,
    );
  }

  const status = error.response?.status ?? 503;
  const payload: unknown = error.response?.data;
  const candidate =
    typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
  const nested =
    typeof candidate.error === "object" && candidate.error !== null
      ? (candidate.error as Record<string, unknown>)
      : candidate;
  const code =
    typeof nested.code === "string" ? nested.code : (DEFAULT_CODES[status] ?? "UPSTREAM_ERROR");
  const message =
    typeof nested.message === "string"
      ? nested.message
      : (DEFAULT_MESSAGES[status] ?? "AraraHQ API request failed.");
  const retryAfterSeconds = parseRetryAfter(error.response?.headers["retry-after"]);
  return new AraraError(code, message, status, status === 429 || status >= 500, retryAfterSeconds);
};
