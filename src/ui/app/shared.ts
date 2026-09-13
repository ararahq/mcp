import { readEnvelope, type ToolEnvelope } from "../model/envelope.js";
import { formatInteger } from "../model/format.js";
import { createBridge, windowChannel, type Bridge, type HostContext } from "./bridge.js";

export const APP_VERSION = "6.0.0";
const COUNT_UP_MS = 700;
const FONTS_STYLE_ID = "__mcp-host-fonts";

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

/** Mirrors the host theme onto the document: theme attribute, CSS variables and fonts. */
export const applyHostContext = (
  context: HostContext,
  root: HTMLElement = document.documentElement,
): void => {
  if (context.theme !== undefined) {
    root.setAttribute("data-theme", context.theme);
    root.style.colorScheme = context.theme;
  }
  for (const [key, value] of Object.entries(context.styles?.variables ?? {})) {
    if (typeof value === "string") root.style.setProperty(key, value);
  }
  const fonts = context.styles?.css?.fonts;
  if (
    typeof fonts === "string" &&
    fonts.length > 0 &&
    document.getElementById(FONTS_STYLE_ID) === null
  ) {
    const style = document.createElement("style");
    style.id = FONTS_STYLE_ID;
    style.textContent = fonts;
    document.head.append(style);
  }
};

/** Tells the host how tall the panel is, so the iframe follows the content. */
const watchSize = (bridge: Bridge): void => {
  let lastWidth = 0;
  let lastHeight = 0;
  let scheduled = false;
  const measure = (): void => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const html = document.documentElement;
      const previous = html.style.height;
      html.style.height = "max-content";
      const height = Math.ceil(html.getBoundingClientRect().height);
      html.style.height = previous;
      const width = Math.ceil(window.innerWidth);
      if (width === lastWidth && height === lastHeight) return;
      lastWidth = width;
      lastHeight = height;
      bridge.sizeChanged(width, height);
    });
  };
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(document.documentElement);
  observer.observe(document.body);
};

/** Boots one panel: connects to the host, applies its theme and wires tool events. */
export const bootPanel = async <T>(handlers: PanelHandlers<T>): Promise<Panel> => {
  const root = document.getElementById("app");
  if (root === null) throw new Error("Panel root missing.");
  const bridge = createBridge(windowChannel(), {
    onToolResult: (result) => handlers.onResult(panel, readEnvelope<T>(result.structuredContent)),
    onToolInput: (args) => handlers.onInput?.(panel, args),
    onHostContext: applyHostContext,
  });
  const panel: Panel = {
    root,
    callTool: async <R>(name: string, args: Record<string, unknown>) =>
      readEnvelope<R>((await bridge.callTool(name, args)).structuredContent),
    ask: (text) => bridge.sendMessage(text),
  };
  applyHostContext(await bridge.connect(`arara-${handlers.name}`, APP_VERSION));
  watchSize(bridge);
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
