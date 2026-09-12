export const SERVER_NAME = "ararahq-mcp";
export const SERVER_VERSION = "6.0.0";
export const DEFAULT_API_BASE_URL = "https://api.ararahq.com/api";
export const OAUTH_CLIENT_ID = "ararahq-mcp";
export const OAUTH_SCOPE =
  "openid profile organization:read messages:write campaigns:read campaigns:write contacts:write templates:write";
export const API_TIMEOUT_MS = 10_000;
export const MAX_RETRIES = 2;
export const MAX_PAGE_SIZE = 100;

export const getApiBaseUrl = (): string =>
  (process.env.ARARA_API_URL ?? DEFAULT_API_BASE_URL).replace(/\/$/, "");

export const getHttpPort = (): number => {
  const raw = process.env.PORT ?? "3333";
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return parsed;
};
