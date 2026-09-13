/**
 * Minimal MCP Apps client: JSON-RPC 2.0 over postMessage between this iframe and
 * the host. Implements only what the panels use, so the bundle stays tiny.
 */
export const PROTOCOL_VERSION = "2026-01-26";

const INITIALIZE = "ui/initialize";
const INITIALIZED = "ui/notifications/initialized";
const SIZE_CHANGED = "ui/notifications/size-changed";
const TOOL_INPUT = "ui/notifications/tool-input";
const TOOL_RESULT = "ui/notifications/tool-result";
const HOST_CONTEXT_CHANGED = "ui/notifications/host-context-changed";
const PING = "ping";
const CALL_TOOL = "tools/call";
const MESSAGE = "ui/message";

type JsonRpcId = number | string;
type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
};

export type HostContext = {
  theme?: "light" | "dark";
  styles?: { variables?: Record<string, string>; css?: { fonts?: string } };
};
export type ToolResult = { structuredContent?: unknown; isError?: boolean };

/** How messages enter and leave; injected so the bridge is testable without a window. */
export type Channel = {
  send: (message: JsonRpcMessage) => void;
  subscribe: (listener: (message: JsonRpcMessage) => void) => () => void;
};

export type BridgeHandlers = {
  onToolInput?: (args: Record<string, unknown>) => void;
  onToolResult?: (result: ToolResult) => void;
  onHostContext?: (context: HostContext) => void;
};

export type Bridge = {
  connect: (appName: string, version: string) => Promise<HostContext>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
  sendMessage: (text: string) => Promise<void>;
  sizeChanged: (width: number, height: number) => void;
};

const isJsonRpc = (data: unknown): data is JsonRpcMessage =>
  typeof data === "object" && data !== null && (data as JsonRpcMessage).jsonrpc === "2.0";

export const windowChannel = (target: Window = window.parent): Channel => ({
  send: (message) => target.postMessage(message, "*"),
  subscribe: (listener) => {
    const handler = (event: MessageEvent): void => {
      if (isJsonRpc(event.data)) listener(event.data);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  },
});

export const createBridge = (channel: Channel, handlers: BridgeHandlers): Bridge => {
  let nextId = 1;
  const pending = new Map<
    JsonRpcId,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  const request = (method: string, params: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      channel.send({ jsonrpc: "2.0", id, method, params });
    });
  const notify = (method: string, params: unknown): void => {
    channel.send({ jsonrpc: "2.0", method, params });
  };

  const onNotification = (method: string, params: unknown): void => {
    const record = (params ?? {}) as Record<string, unknown>;
    if (method === TOOL_INPUT) {
      handlers.onToolInput?.((record.arguments ?? {}) as Record<string, unknown>);
    } else if (method === TOOL_RESULT) {
      handlers.onToolResult?.(record);
    } else if (method === HOST_CONTEXT_CHANGED) {
      handlers.onHostContext?.(record);
    }
  };

  channel.subscribe((message) => {
    if (message.id !== undefined && message.method === undefined) {
      const waiter = pending.get(message.id);
      if (waiter === undefined) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
      return;
    }
    if (message.method === PING && message.id !== undefined) {
      channel.send({ jsonrpc: "2.0", id: message.id, result: {} });
      return;
    }
    if (message.method !== undefined) onNotification(message.method, message.params);
  });

  return {
    connect: async (appName, version) => {
      const result = (await request(INITIALIZE, {
        appInfo: { name: appName, version },
        appCapabilities: {},
        protocolVersion: PROTOCOL_VERSION,
      })) as { hostContext?: HostContext };
      notify(INITIALIZED, {});
      return result.hostContext ?? {};
    },
    callTool: (name, args) => request(CALL_TOOL, { name, arguments: args }) as Promise<ToolResult>,
    sendMessage: async (text) => {
      await request(MESSAGE, { role: "user", content: [{ type: "text", text }] });
    },
    sizeChanged: (width, height) => notify(SIZE_CHANGED, { width, height }),
  };
};
