import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiRequest } from "../lib/api.js";
import {
  balanceSchema,
  campaignListSchema,
  identitySchema,
  numbersSchema,
  pagedTemplatesSchema,
  planSchema,
} from "../lib/schemas.js";

const RECENT_CAMPAIGNS_SIZE = 10;
const APPROVED_STATUS = "APPROVED";

const json = (value: unknown): string => JSON.stringify(value, null, 2);

const registerJsonResource = (
  server: McpServer,
  name: string,
  uri: string,
  title: string,
  description: string,
  loader: () => Promise<unknown>,
): void => {
  server.registerResource(
    name,
    uri,
    { title, description, mimeType: "application/json" },
    async (resourceUri) => {
      try {
        return {
          contents: [
            {
              uri: resourceUri.toString(),
              mimeType: "application/json",
              text: json(await loader()),
            },
          ],
        };
      } catch {
        return {
          contents: [
            {
              uri: resourceUri.toString(),
              mimeType: "application/json",
              text: json({
                error: { code: "RESOURCE_UNAVAILABLE", message: "Resource could not be loaded." },
              }),
            },
          ],
        };
      }
    },
  );
};

export const registerAllResources = (server: McpServer): void => {
  registerJsonResource(
    server,
    "organization",
    "arara://organization",
    "Organization",
    "Authenticated identity, current plan and wallet balance.",
    async () => {
      const [identity, plan, balance] = await Promise.all([
        apiRequest("/auth/me", { schema: identitySchema }),
        apiRequest("/v1/organizations/me/plan", { schema: planSchema }),
        apiRequest("/dashboard/wallet/balance", { schema: balanceSchema }),
      ]);
      return { identity, plan, balance };
    },
  );
  registerJsonResource(
    server,
    "approved_templates",
    "arara://templates/approved",
    "Approved templates",
    "Templates Meta currently allows for sending. Use their names in broadcast and send_whatsapp.",
    async () => {
      const params = new URLSearchParams({ status: APPROVED_STATUS, size: "100" });
      const templates = await apiRequest(`/v1/templates?${params.toString()}`, {
        schema: pagedTemplatesSchema,
      });
      return templates.filter((template) => template.availableForSending);
    },
  );
  registerJsonResource(
    server,
    "recent_campaigns",
    "arara://campaigns/recent",
    "Recent campaigns",
    "Latest broadcasts with status, counts and cost.",
    async () => {
      const params = new URLSearchParams({ page: "0", size: String(RECENT_CAMPAIGNS_SIZE) });
      const result = await apiRequest(`/v1/campaigns?${params.toString()}`, {
        schema: campaignListSchema,
      });
      return result.data;
    },
  );
  registerJsonResource(
    server,
    "channels",
    "arara://channels",
    "WhatsApp numbers",
    "Configured sending numbers and slot state for this organization.",
    () => apiRequest("/v1/organizations/me/numbers", { schema: numbersSchema }),
  );
};
