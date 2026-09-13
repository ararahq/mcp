import { describe, expect, it } from "vitest";
import { extractBearer, isOriginAllowed, policyFromEnv } from "./policy.js";

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
});
