import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryIdentityCache, policyFromEnv } from "./policy.js";
import { createWebHandler } from "./web.js";

const policy = policyFromEnv({
  MCP_ALLOWED_HOSTS: "mcp.test",
  MCP_ALLOWED_ORIGINS: "https://claude.ai",
  MCP_PUBLIC_URL: "https://mcp.test/mcp",
  ARARA_OAUTH_ISSUER: "https://api.test/api",
  ARARA_API_URL: "https://api.test/api",
});
const loadPanel = () => Promise.resolve("<p>panel</p>");
const handler = createWebHandler({ policy, loadPanel });

const request = (path: string, init: RequestInit = {}, host = "mcp.test"): Request =>
  new Request(`https://${host}${path}`, init);

const mcpInit = (headers: Record<string, string> = {}): Request =>
  request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    }),
  });

describe("hosted web handler", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get("authorization");
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/auth/me") && auth === "Bearer good") {
        return Promise.resolve(
          new Response(JSON.stringify({ name: "Micael", email: "m@ararahq.com" })),
        );
      }
      return Promise.resolve(new Response("{}", { status: 401 }));
    });
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("refuses unknown hosts before anything else", async () => {
    const response = await handler(request("/health", {}, "evil.test"));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "HOST_NOT_ALLOWED" } });
  });

  it("refuses browser origins that are not allowlisted", async () => {
    const response = await handler(request("/health", { headers: { origin: "https://x.test" } }));
    expect(response.status).toBe(403);
  });

  it("answers preflight with CORS headers for an allowed origin", async () => {
    const response = await handler(
      request("/mcp", { method: "OPTIONS", headers: { origin: "https://claude.ai" } }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://claude.ai");
  });

  it("serves health and the protected resource metadata", async () => {
    const health = await handler(request("/health"));
    expect(await health.json()).toMatchObject({ status: "ok" });
    const metadata = await handler(request("/.well-known/oauth-protected-resource/mcp"));
    expect(await metadata.json()).toMatchObject({
      resource: "https://mcp.test/mcp",
      authorization_servers: ["https://api.test/api"],
    });
  });

  it("returns 404 elsewhere and 405 for GET on /mcp", async () => {
    expect((await handler(request("/nope"))).status).toBe(404);
    const get = await handler(request("/mcp"));
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
  });

  it("challenges requests without a valid bearer", async () => {
    const missing = await handler(mcpInit());
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toContain("resource_metadata=");
    const bad = await handler(mcpInit({ authorization: "Bearer nope" }));
    expect(bad.status).toBe(401);
  });

  it("initializes an MCP session for a valid bearer", async () => {
    const response = await handler(mcpInit({ authorization: "Bearer good" }));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('"serverInfo"');
    expect(text).toContain("ararahq-mcp");
  });

  it("rate limits per authenticated user, after the bearer is validated", async () => {
    const isRateLimited = vi.fn<(userKey: string) => Promise<boolean>>(() => Promise.resolve(true));
    const limited = createWebHandler({ policy, loadPanel, isRateLimited });
    expect((await limited(request("/health"))).status).toBe(200);
    expect((await limited(mcpInit({ authorization: "Bearer nope" }))).status).toBe(401);
    const response = await limited(mcpInit({ authorization: "Bearer good" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(isRateLimited).toHaveBeenCalledTimes(1);
    expect(isRateLimited.mock.calls[0]?.[0]).toMatch(/^user:[0-9a-f]{64}$/);
  });

  it("serves repeat calls from the identity cache without hitting the API", async () => {
    const cache = createMemoryIdentityCache();
    const cached = createWebHandler({ policy, loadPanel, identityCache: cache });
    await cached(mcpInit({ authorization: "Bearer good" }));
    await cached(mcpInit({ authorization: "Bearer good" }));
    const identityCalls = vi.mocked(globalThis.fetch).mock.calls.filter((call) => {
      const input = call[0];
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return url.endsWith("/auth/me");
    });
    expect(identityCalls).toHaveLength(1);
  });
});
