import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** MIME type hosts use to recognise an MCP Apps panel resource. */
export const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";

export const UI_PANELS = {
  campaign: "Campaign report with funnel, live progress and next actions.",
  broadcast: "Broadcast preview with phone mockup, approval and live delivery.",
  status: "Delivery timeline, 24h window state or template approval.",
  conversation: "Chat thread with one person and an inline reply box.",
} as const;

export type UiPanel = keyof typeof UI_PANELS;
export type PanelLoader = (panel: UiPanel) => Promise<string>;

export const uiResourceUri = (panel: UiPanel): string => `ui://arara/${panel}.html`;

export const registerUiResources = (server: McpServer, loadPanel: PanelLoader): void => {
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
        contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: await loadPanel(panel) }],
      }),
    );
  }
};
