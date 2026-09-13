import { API_TIMEOUT_MS, DEFAULT_API_BASE_URL } from "../config.js";
import { identitySchema } from "../lib/schemas.js";

export const DEFAULT_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "mcp.ararahq.com"];
export const DEFAULT_ALLOWED_ORIGINS = ["https://chatgpt.com", "https://claude.ai"];
export const DEFAULT_PUBLIC_URL = "https://mcp.ararahq.com/mcp";
export const DEFAULT_METADATA_URL =
  "https://mcp.ararahq.com/.well-known/oauth-protected-resource/mcp";
export const IDENTITY_CACHE_TTL_SECONDS = 60;

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

export type Identity = { name: string; email: string };

/**
 * Short-lived memory of which bearer maps to which identity, keyed by a token
 * fingerprint. Saves one API round trip per tool call inside the TTL. The token
 * itself is never stored.
 */
export type IdentityCache = {
  get: (fingerprint: string) => Promise<Identity | undefined>;
  set: (fingerprint: string, identity: Identity) => Promise<void>;
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

/** SHA-256 hex of any secret, so caches and rate-limit keys never hold the value itself. */
export const fingerprint = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const fetchIdentity = async (policy: HostedPolicy, token: string): Promise<Identity | null> => {
  try {
    const response = await fetch(`${policy.apiBaseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const parsed = identitySchema.safeParse(await response.json());
    return parsed.success ? { name: parsed.data.name, email: parsed.data.email } : null;
  } catch {
    return null;
  }
};

/** Resolves a bearer to its identity, through the cache when one is given. */
export const validateToken = async (
  policy: HostedPolicy,
  token: string,
  cache?: IdentityCache,
): Promise<Identity | null> => {
  const key = cache === undefined ? undefined : await fingerprint(token);
  if (cache !== undefined && key !== undefined) {
    const cached = await cache.get(key);
    if (cached !== undefined) return cached;
  }
  const identity = await fetchIdentity(policy, token);
  if (identity !== null && cache !== undefined && key !== undefined) await cache.set(key, identity);
  return identity;
};

/** Process-local cache for the Node runtime. Entries expire after the TTL. */
export const createMemoryIdentityCache = (
  ttlSeconds = IDENTITY_CACHE_TTL_SECONDS,
  now: () => number = Date.now,
): IdentityCache => {
  const entries = new Map<string, { identity: Identity; expiresAt: number }>();
  return {
    get: (key) => {
      const entry = entries.get(key);
      if (entry === undefined) return Promise.resolve(undefined);
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return Promise.resolve(undefined);
      }
      return Promise.resolve(entry.identity);
    },
    set: (key, identity) => {
      entries.set(key, { identity, expiresAt: now() + ttlSeconds * 1_000 });
      return Promise.resolve();
    },
  };
};
