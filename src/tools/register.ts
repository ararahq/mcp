import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import { failure, toolOutputSchema } from "../mcp/result.js";

export const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
export const write = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};
export const idempotentWrite = { ...write, idempotentHint: true };
export const destructive = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

export type ToolAnnotations = typeof readOnly;
export type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>;
export type ToolOptions = { gate?: () => Promise<void>; ui?: string };

/**
 * Registers a tool with the shared output envelope. An optional [gate] runs before
 * the handler and refuses the call through the same structured failure envelope. An
 * optional [ui] resource URI links the tool to an MCP Apps panel.
 */
export const register = (
  server: McpServer,
  name: string,
  description: string,
  inputSchema: Record<string, z.ZodTypeAny>,
  annotations: ToolAnnotations,
  handler: ToolHandler,
  options: ToolOptions = {},
): void => {
  const { gate, ui } = options;
  const wrapped: ToolHandler =
    gate === undefined
      ? handler
      : async (input) => {
          try {
            await gate();
          } catch (error) {
            return failure(error);
          }
          return handler(input);
        };
  server.registerTool(
    name,
    {
      description,
      inputSchema,
      outputSchema: toolOutputSchema,
      annotations,
      ...(ui === undefined ? {} : { _meta: { ui: { resourceUri: ui } } }),
    },
    wrapped as never,
  );
};
