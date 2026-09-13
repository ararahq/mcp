import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "../config.js";
import { registerAllPrompts } from "../prompts/index.js";
import { registerAllResources } from "../resources/index.js";
import { registerAllTools } from "../tools/index.js";
import { registerOperatorTools } from "../tools/operator.js";
import { registerUiResources, type PanelLoader } from "../ui/resources.js";

export type ServerOptions = { loadPanel: PanelLoader };

export const createServer = (options: ServerOptions): McpServer => {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerAllTools(server);
  registerOperatorTools(server);
  registerAllResources(server);
  registerUiResources(server, options.loadPanel);
  registerAllPrompts(server);
  return server;
};
