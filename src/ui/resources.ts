import { readFile } from "node:fs/promises";
import path from "node:path";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const UI_PANELS = {
  campaign: "Campaign report with funnel, live progress and next actions.",
  broadcast: "Broadcast preview with phone mockup, approval and live delivery.",
  status: "Delivery timeline, 24h window state or template approval.",
  conversation: "Chat thread with one person and an inline reply box.",
} as const;

export type UiPanel = keyof typeof UI_PANELS;

export const uiResourceUri = (panel: UiPanel): string => `ui://arara/${panel}.html`;

const FALLBACK_HTML = "<!doctype html><p>Panel not built. Run npm run build.</p>";

export const loadPanelHtml = async (panel: UiPanel, dir = import.meta.dirname): Promise<string> =>
  readFile(path.join(dir, `${panel}.html`), "utf8").catch(() => FALLBACK_HTML);

export const registerUiResources = (server: McpServer): void => {
  for (const [panel, description] of Object.entries(UI_PANELS) as Array<[UiPanel, string]>) {
    const uri = uiResourceUri(panel);
    server.registerResource(
      `ui_${panel}`,
      uri,
      {
        title: `Arara ${panel} panel`,
        description,
        mimeType: RESOURCE_MIME_TYPE,
        _meta: { ui: { prefersBorder: true } },
      },
      async () => ({
        contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: await loadPanelHtml(panel) }],
      }),
    );
  }
};
