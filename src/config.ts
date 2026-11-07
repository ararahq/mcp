export const SERVER_NAME = "ararahq-mcp";
export const SERVER_VERSION = "6.0.1";
export const DEFAULT_API_BASE_URL = "https://api.ararahq.com/api";
export const OAUTH_CLIENT_ID = "arara-mcp";
export const OAUTH_SCOPE =
  "openid profile organization:read messages:write campaigns:read campaigns:write contacts:write templates:write";
export const API_TIMEOUT_MS = 10_000;
export const MAX_RETRIES = 2;
export const MAX_PAGE_SIZE = 100;

export const getApiBaseUrl = (): string =>
  (process.env.ARARA_API_URL ?? DEFAULT_API_BASE_URL).replace(/\/$/, "");
