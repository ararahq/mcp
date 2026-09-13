import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { runWithAccessToken } from "../auth/context.js";
import { SERVER_NAME, SERVER_VERSION } from "../config.js";
import { createServer, type ServerOptions } from "../server/create.js";
import {
  extractBearer,
  isHostAllowed,
  isOriginAllowed,
  protectedResourceMetadata,
  validateToken,
  type HostedPolicy,
} from "./policy.js";

const MCP_PATH = "/mcp";
const HEALTH_PATH = "/health";
const METADATA_PATHS = new Set([
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
]);
const CORS_METHODS = "POST, OPTIONS";
const CORS_HEADERS = "Authorization, Content-Type, MCP-Protocol-Version, Mcp-Session-Id";

export type WebHandlerOptions = ServerOptions & {
  policy: HostedPolicy;
  /** Returns true when the caller is over its budget. Absent means no limit at this layer. */
  isRateLimited?: (request: Request) => Promise<boolean>;
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const errorResponse = (status: number, code: string, message: string): Response =>
  json(status, { error: { code, message } });

const withCors = (response: Response, origin: string | null): Response => {
  if (origin === null) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", CORS_METHODS);
  headers.set("Access-Control-Allow-Headers", CORS_HEADERS);
  headers.set("Vary", "Origin");
  return new Response(response.body, { status: response.status, headers });
};

const unauthorized = (policy: HostedPolicy): Response =>
  json(
    401,
    { error: { code: "UNAUTHENTICATED", message: "A valid OAuth bearer token is required." } },
    { "WWW-Authenticate": `Bearer resource_metadata="${policy.metadataUrl}"` },
  );

const handleMcp = async (request: Request, options: WebHandlerOptions): Promise<Response> => {
  const token = extractBearer(request.headers.get("authorization"));
  if (token === null || !(await validateToken(options.policy, token))) {
    return unauthorized(options.policy);
  }
  const server = createServer({ loadPanel: options.loadPanel });
  const transport = new WebStandardStreamableHTTPServerTransport({});
  await server.connect(transport);
  return runWithAccessToken(token, () => transport.handleRequest(request));
};

const route = async (request: Request, options: WebHandlerOptions): Promise<Response> => {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === HEALTH_PATH) {
    return json(200, { status: "ok", name: SERVER_NAME, version: SERVER_VERSION });
  }
  if (request.method === "GET" && METADATA_PATHS.has(url.pathname)) {
    return json(200, protectedResourceMetadata(options.policy));
  }
  if (url.pathname !== MCP_PATH) return errorResponse(404, "NOT_FOUND", "Not found.");
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }
  try {
    return await handleMcp(request, options);
  } catch {
    return errorResponse(500, "INTERNAL_ERROR", "Request failed.");
  }
};

/**
 * Web Standard request handler shared by every hosted runtime (Workers, Node).
 * Host and origin checks run before anything else so a rebinding attempt never
 * reaches the MCP server.
 */
export const createWebHandler =
  (options: WebHandlerOptions) =>
  async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    if (!isHostAllowed(options.policy, url.hostname)) {
      return errorResponse(403, "HOST_NOT_ALLOWED", "Host is not allowed.");
    }
    if (!isOriginAllowed(options.policy, origin)) {
      return errorResponse(403, "ORIGIN_NOT_ALLOWED", "Origin is not allowed.");
    }
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }), origin);
    }
    if (options.isRateLimited !== undefined && (await options.isRateLimited(request))) {
      return withCors(
        json(
          429,
          { error: { code: "RATE_LIMITED", message: "Too many requests." } },
          { "Retry-After": "60" },
        ),
        origin,
      );
    }
    return withCors(await route(request, options), origin);
  };
