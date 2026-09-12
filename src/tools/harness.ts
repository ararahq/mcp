import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MockedFunction } from "vitest";
import type { apiRequest } from "../lib/api.js";
import type { ToolHandler } from "./register.js";

export type ToolResult = {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
  structuredContent: {
    ok: boolean;
    data?: unknown;
    error?: { code: string; message: string; retryable: boolean };
  };
};

/**
 * Test-only stand-in for McpServer that captures registered tools so handlers can
 * be invoked directly, without a transport.
 */
export const fakeServer = () => {
  const tools = new Map<string, ToolHandler>();
  const server = {
    registerTool: (name: string, _meta: unknown, handler: ToolHandler) => {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  const call = async (name: string, input: Record<string, unknown> = {}): Promise<ToolResult> => {
    const handler = tools.get(name);
    if (handler === undefined) throw new Error(`Tool ${name} is not registered.`);
    return (await handler(input)) as ToolResult;
  };
  return { server, tools, call };
};

/**
 * Queues one raw backend payload for a mocked apiRequest, still running it through
 * the schema the caller passed so tests exercise the real contract parsing.
 */
export const respondWith = (mocked: MockedFunction<typeof apiRequest>, raw: unknown): void => {
  mocked.mockImplementationOnce((_path, options) => Promise.resolve(options.schema.parse(raw)));
};
