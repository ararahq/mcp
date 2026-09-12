import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readEnvelope, type ToolEnvelope } from "../model/envelope.js";
import { formatInteger } from "../model/format.js";

export const APP_VERSION = "6.0.0";
const COUNT_UP_MS = 700;

export type Panel = {
  root: HTMLElement;
  callTool: <T>(name: string, args: Record<string, unknown>) => Promise<ToolEnvelope<T>>;
  ask: (text: string) => Promise<void>;
};

type PanelHandlers<T> = {
  name: string;
  onResult: (panel: Panel, result: ToolEnvelope<T>) => void;
  onInput?: (panel: Panel, args: Record<string, unknown>) => void;
};

type HostContext = ReturnType<App["getHostContext"]>;

const applyContext = (context: HostContext): void => {
  if (context === undefined) return;
  if (context.theme !== undefined) applyDocumentTheme(context.theme);
  if (context.styles?.variables !== undefined) applyHostStyleVariables(context.styles.variables);
  const fonts = context.styles?.css?.fonts;
  if (typeof fonts === "string" && fonts.length > 0) applyHostFonts(fonts);
};

/** Boots one panel: connects to the host, applies its theme and wires tool events. */
export const bootPanel = async <T>(handlers: PanelHandlers<T>): Promise<Panel> => {
  const app = new App({ name: `arara-${handlers.name}`, version: APP_VERSION });
  const root = document.getElementById("app");
  if (root === null) throw new Error("Panel root missing.");

  const panel: Panel = {
    root,
    callTool: async <R>(name: string, args: Record<string, unknown>) => {
      const result: CallToolResult = await app.callServerTool({ name, arguments: args });
      return readEnvelope<R>(result.structuredContent);
    },
    ask: async (text: string) => {
      await app.sendMessage({ role: "user", content: [{ type: "text", text }] });
    },
  };

  app.ontoolresult = (result) =>
    handlers.onResult(panel, readEnvelope<T>(result.structuredContent));
  app.ontoolinput = (params) => {
    handlers.onInput?.(panel, params.arguments ?? {});
  };
  app.onhostcontextchanged = (context) => applyContext(context);
  await app.connect();
  applyContext(app.getHostContext());
  return panel;
};

/** Tiny hyperscript so panels stay dependency-free. */
export const h = (
  tag: string,
  attrs: Record<string, string | boolean | (() => void)> = {},
  ...children: Array<Node | string | null | undefined | false>
): HTMLElement => {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === "function") element.addEventListener(key.replace(/^on/, ""), value);
    else if (typeof value === "boolean") element.toggleAttribute(key, value);
    else element.setAttribute(key, value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return element;
};

export const replace = (root: HTMLElement, ...children: HTMLElement[]): void => {
  root.replaceChildren(...children);
};

/** Animates an integer from zero to its value so numbers feel alive when a panel opens. */
export const countUp = (element: HTMLElement, value: number, format = formatInteger): void => {
  const start = performance.now();
  const tick = (now: number): void => {
    const progress = Math.min(1, (now - start) / COUNT_UP_MS);
    const eased = 1 - (1 - progress) ** 3;
    element.textContent = format(value * eased);
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

export const errorBox = (message: string): HTMLElement => h("div", { class: "error" }, message);

export const skeleton = (rows = 4): HTMLElement =>
  h(
    "div",
    { class: "panel" },
    ...Array.from({ length: rows }, () => h("div", { class: "skeleton" })),
  );

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
