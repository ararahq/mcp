import { API_TIMEOUT_MS, DEFAULT_API_BASE_URL } from "../config.js";
import { identitySchema } from "../lib/schemas.js";

export const DEFAULT_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "mcp.ararahq.com"];
export const DEFAULT_ALLOWED_ORIGINS = ["https://chatgpt.com", "https://claude.ai"];
export const DEFAULT_PUBLIC_URL = "https://mcp.ararahq.com/mcp";
export const DEFAULT_METADATA_URL =
  "https://mcp.ararahq.com/.well-known/oauth-protected-resource/mcp";

/** Everything the hosted transport needs to decide who may talk to it. */
export type HostedPolicy = {
  allowedHosts: string[];
  allowedOrigins: string[];
  publicUrl: string;
  metadataUrl: string;
  oauthIssuer: string;
  scopes: string[];
  apiBaseUrl: string;
};

const splitList = (raw: string | undefined, fallback: string[]): string[] =>
  (raw?.split(",") ?? fallback).map((item) => item.trim().toLowerCase()).filter(Boolean);

/** Builds the policy from a flat env map, so Node and Workers read the same variables. */
export const policyFromEnv = (env: Record<string, string | undefined>): HostedPolicy => {
  const apiBaseUrl = (env.ARARA_API_URL ?? DEFAULT_API_BASE_URL).replace(/\/$/, "");
  return {
    allowedHosts: splitList(env.MCP_ALLOWED_HOSTS, DEFAULT_ALLOWED_HOSTS),
    allowedOrigins: splitList(env.MCP_ALLOWED_ORIGINS, DEFAULT_ALLOWED_ORIGINS),
    publicUrl: env.MCP_PUBLIC_URL ?? DEFAULT_PUBLIC_URL,
    metadataUrl: env.MCP_RESOURCE_METADATA_URL ?? DEFAULT_METADATA_URL,
    oauthIssuer: env.ARARA_OAUTH_ISSUER ?? apiBaseUrl,
    scopes: env.ARARA_OAUTH_SCOPES?.split(" ").filter(Boolean) ?? [],
    apiBaseUrl,
  };
};

export const isHostAllowed = (policy: HostedPolicy, hostname: string): boolean =>
  policy.allowedHosts.includes(hostname.toLowerCase());

/** A missing Origin is a non-browser client and is allowed; a present one must match. */
export const isOriginAllowed = (policy: HostedPolicy, origin: string | null): boolean => {
  if (origin === null || origin.length === 0) return true;
  try {
    return policy.allowedOrigins.includes(new URL(origin).origin.toLowerCase());
  } catch {
    return false;
  }
};

export const extractBearer = (header: string | null): string | null => {
  if (typeof header !== "string") return null;
  const match = /^Bearer ([^\s]+)$/i.exec(header.trim());
  return match?.[1] ?? null;
};

export const protectedResourceMetadata = (policy: HostedPolicy): Record<string, unknown> => ({
  resource: policy.publicUrl,
  authorization_servers: [policy.oauthIssuer],
  bearer_methods_supported: ["header"],
  scopes_supported: policy.scopes,
});

/** Validates a bearer against the API identity endpoint with the platform fetch. */
export const validateToken = async (policy: HostedPolicy, token: string): Promise<boolean> => {
  try {
    const response = await fetch(`${policy.apiBaseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    return identitySchema.safeParse(await response.json()).success;
  } catch {
    return false;
  }
};
