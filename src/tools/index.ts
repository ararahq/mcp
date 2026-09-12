import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiRequest } from "../lib/api.js";
import { balanceSchema, identitySchema, planSchema } from "../lib/schemas.js";
import { execute } from "../mcp/result.js";
import { registerCampaignTools } from "./campaigns.js";
import { registerContactTools } from "./contacts.js";
import { readOnly, register } from "./register.js";
import { registerSendTools } from "./send.js";
import { registerTemplateTools } from "./templates.js";

export { destructive, idempotentWrite, readOnly, register, write } from "./register.js";

export const TOOL_NAMES = [
  "whoami",
  "send_whatsapp",
  "broadcast",
  "campaign_report",
  "check_status",
  "create_template",
  "save_contacts",
  "opt_out",
  "read_conversation",
] as const;

const registerWhoami = (server: McpServer): void => {
  register(
    server,
    "whoami",
    "Confirm who is authenticated, which organization will send, the current plan and the wallet balance. Call it before the first broadcast of a session.",
    {},
    readOnly,
    async () =>
      execute(async () => {
        const [identity, plan, balance] = await Promise.all([
          apiRequest("/auth/me", { schema: identitySchema }),
          apiRequest("/v1/organizations/me/plan", { schema: planSchema }),
          apiRequest("/dashboard/wallet/balance", { schema: balanceSchema }),
        ]);
        const planName = typeof plan.current === "string" ? plan.current : "unknown";
        return {
          data: { identity, plan, balance },
          message: `Authenticated as ${identity.name} (${identity.email}) on plan ${planName}.`,
        };
      }),
  );
};

export const registerAllTools = (server: McpServer): void => {
  registerWhoami(server);
  registerSendTools(server);
  registerCampaignTools(server);
  registerTemplateTools(server);
  registerContactTools(server);
};
