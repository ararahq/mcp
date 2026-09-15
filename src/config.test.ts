import packageJson from "../package.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import { DEFAULT_API_BASE_URL, OAUTH_CLIENT_ID, SERVER_NAME, SERVER_VERSION } from "./config.js";
import { TOOL_NAMES } from "./tools/index.js";

describe("public contract", () => {
  it("keeps the runtime and package versions aligned", () => {
    expect(SERVER_VERSION).toBe(packageJson.version);
  });

  it("uses the canonical identity and production API", () => {
    expect(SERVER_NAME).toBe("ararahq-mcp");
    expect(DEFAULT_API_BASE_URL).toBe("https://api.ararahq.com/api");
  });

  it("uses the device-flow client_id registered in the Arara API", () => {
    expect(OAUTH_CLIENT_ID).toBe("arara-mcp");
  });

  it("contains no Atendimento-era or credential tools", () => {
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length);
    expect(TOOL_NAMES).not.toContain("get_today");
    expect(TOOL_NAMES).not.toContain("publish_campaign");
    expect(TOOL_NAMES).not.toContain("login");
  });
});
