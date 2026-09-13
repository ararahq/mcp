import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "../server/create.js";
import { loadPanelFromDisk } from "../ui/panel-files.js";

export const runStdio = async (): Promise<void> => {
  const server = createServer({ loadPanel: loadPanelFromDisk() });
  await server.connect(new StdioServerTransport());
};
