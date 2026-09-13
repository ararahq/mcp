import { describe, expect, it, vi } from "vitest";
import { createBridge, PROTOCOL_VERSION, type Channel } from "./bridge.js";

type Message = Parameters<Channel["send"]>[0];

/** In-memory host on the other side of the channel. */
const fakeHost = () => {
  const sent: Message[] = [];
  let listener: ((message: Message) => void) | undefined;
  const channel: Channel = {
    send: (message) => sent.push(message),
    subscribe: (fn) => {
      listener = fn;
      return () => {
        listener = undefined;
      };
    },
  };
  const deliver = (message: Message): void => listener?.(message);
  return { channel, sent, deliver };
};

describe("MCP Apps bridge", () => {
  it("performs the initialize handshake and returns the host context", async () => {
    const host = fakeHost();
    const bridge = createBridge(host.channel, {});
    const connecting = bridge.connect("arara-test", "6.0.0");
    const init = host.sent[0];
    expect(init).toMatchObject({
      method: "ui/initialize",
      params: { appInfo: { name: "arara-test" }, protocolVersion: PROTOCOL_VERSION },
    });
    host.deliver({
      jsonrpc: "2.0",
      id: init?.id ?? 0,
      result: { protocolVersion: PROTOCOL_VERSION, hostContext: { theme: "dark" } },
    });
    await expect(connecting).resolves.toEqual({ theme: "dark" });
    expect(host.sent[1]).toMatchObject({ method: "ui/notifications/initialized" });
  });

  it("dispatches tool input, tool result and host context notifications", () => {
    const host = fakeHost();
    const onToolInput = vi.fn();
    const onToolResult = vi.fn();
    const onHostContext = vi.fn();
    createBridge(host.channel, { onToolInput, onToolResult, onHostContext });
    host.deliver({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-input",
      params: { arguments: { a: 1 } },
    });
    host.deliver({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: { structuredContent: { ok: true } },
    });
    host.deliver({
      jsonrpc: "2.0",
      method: "ui/notifications/host-context-changed",
      params: { theme: "light" },
    });
    expect(onToolInput).toHaveBeenCalledWith({ a: 1 });
    expect(onToolResult).toHaveBeenCalledWith({ structuredContent: { ok: true } });
    expect(onHostContext).toHaveBeenCalledWith({ theme: "light" });
  });

  it("correlates tool calls by id and surfaces JSON-RPC errors", async () => {
    const host = fakeHost();
    const bridge = createBridge(host.channel, {});
    const first = bridge.callTool("whoami", {});
    const second = bridge.callTool("broadcast", { dryRun: true });
    const [firstMessage, secondMessage] = host.sent;
    expect(secondMessage).toMatchObject({ method: "tools/call", params: { name: "broadcast" } });
    host.deliver({
      jsonrpc: "2.0",
      id: secondMessage?.id ?? 0,
      result: { structuredContent: { ok: true } },
    });
    host.deliver({
      jsonrpc: "2.0",
      id: firstMessage?.id ?? 0,
      error: { code: -1, message: "nope" },
    });
    await expect(second).resolves.toEqual({ structuredContent: { ok: true } });
    await expect(first).rejects.toThrow("nope");
  });

  it("answers host pings and sends messages and sizes", async () => {
    const host = fakeHost();
    const bridge = createBridge(host.channel, {});
    host.deliver({ jsonrpc: "2.0", id: 42, method: "ping" });
    expect(host.sent[0]).toEqual({ jsonrpc: "2.0", id: 42, result: {} });
    const sending = bridge.sendMessage("oi");
    host.deliver({ jsonrpc: "2.0", id: host.sent[1]?.id ?? 0, result: {} });
    await expect(sending).resolves.toBeUndefined();
    bridge.sizeChanged(640, 480);
    expect(host.sent.at(-1)).toMatchObject({
      method: "ui/notifications/size-changed",
      params: { width: 640, height: 480 },
    });
  });
});
