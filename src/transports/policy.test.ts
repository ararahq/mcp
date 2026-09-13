import { describe, expect, it } from "vitest";
import {
  createMemoryIdentityCache,
  extractBearer,
  fingerprint,
  isOriginAllowed,
  policyFromEnv,
} from "./policy.js";

describe("hosted policy", () => {
  it("falls back to production defaults and lowercases lists", () => {
    const policy = policyFromEnv({ MCP_ALLOWED_HOSTS: " MCP.Ararahq.com ,localhost" });
    expect(policy.allowedHosts).toEqual(["mcp.ararahq.com", "localhost"]);
    expect(policy.allowedOrigins).toContain("https://claude.ai");
    expect(policy.oauthIssuer).toBe(policy.apiBaseUrl);
  });

  it("allows non-browser callers and rejects malformed origins", () => {
    const policy = policyFromEnv({});
    expect(isOriginAllowed(policy, null)).toBe(true);
    expect(isOriginAllowed(policy, "https://claude.ai/chat")).toBe(true);
    expect(isOriginAllowed(policy, "not a url")).toBe(false);
  });

  it("extracts only well-formed bearer tokens", () => {
    expect(extractBearer("Bearer abc")).toBe("abc");
    expect(extractBearer("bearer abc")).toBe("abc");
    expect(extractBearer("Basic abc")).toBeNull();
    expect(extractBearer(null)).toBeNull();
  });

  it("fingerprints secrets as stable sha-256 hex", async () => {
    const hash = await fingerprint("abc");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await fingerprint("abc")).toBe(hash);
    expect(await fingerprint("abd")).not.toBe(hash);
  });

  it("expires memory cache entries after the ttl", async () => {
    let clock = 1_000;
    const cache = createMemoryIdentityCache(60, () => clock);
    await cache.set("k", { name: "A", email: "a@x" });
    expect(await cache.get("k")).toEqual({ name: "A", email: "a@x" });
    clock += 61_000;
    expect(await cache.get("k")).toBeUndefined();
  });
});
