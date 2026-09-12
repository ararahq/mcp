import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiRequest } from "../lib/api.js";
import { templateSchema } from "../lib/schemas.js";
import { execute } from "../mcp/result.js";
import { register, write } from "./register.js";
import { e164Schema } from "./send.js";

const MAX_TEMPLATE_NAME = 512;
const MAX_TEMPLATE_BODY = 4096;
const MAX_FOOTER = 60;
const MAX_BUTTONS = 2;
const DEFAULT_LANGUAGE = "pt_BR";
const DEFAULT_HEADER_TYPE = "text";

const buttonSchema = z.object({
  type: z.enum(["QUICK_REPLY", "URL", "PHONE_NUMBER", "SMART_LINK", "COPY_CODE"]),
  text: z.string().trim().min(1),
  url: z.string().url().optional(),
  phone: e164Schema.optional(),
});

const registerCreateTemplate = (server: McpServer): void => {
  register(
    server,
    "create_template",
    "Submit a WhatsApp template for Meta approval. Needed for broadcasts and for messaging outside the 24h window. Body uses positional placeholders like 'Oi {{1}}, seu pedido {{2}} saiu'; Meta rejects bodies that are only variables. Up to 2 buttons; a SMART_LINK button gets its clicks counted in campaign_report. Track approval with check_status(templateId).",
    {
      name: z
        .string()
        .regex(/^[a-z0-9_]+$/, "Lowercase letters, digits and underscores only.")
        .max(MAX_TEMPLATE_NAME),
      category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
      body: z.string().trim().min(1).max(MAX_TEMPLATE_BODY),
      language: z.string().default(DEFAULT_LANGUAGE),
      header: z.string().trim().min(1).optional(),
      headerType: z.enum(["text", "media", "document"]).optional(),
      footer: z.string().trim().min(1).max(MAX_FOOTER).optional(),
      samples: z.record(z.string()).optional(),
      buttons: z.array(buttonSchema).max(MAX_BUTTONS).optional(),
    },
    write,
    async (input) =>
      execute(async () => {
        const header =
          typeof input.header === "string"
            ? {
                header: input.header,
                headerType:
                  typeof input.headerType === "string" ? input.headerType : DEFAULT_HEADER_TYPE,
              }
            : {};
        const data = await apiRequest("/v1/templates", {
          method: "POST",
          body: {
            name: input.name,
            category: input.category,
            body: input.body,
            language: input.language,
            ...header,
            ...(typeof input.footer === "string" ? { footer: input.footer } : {}),
            ...(input.samples === undefined ? {} : { samples: input.samples }),
            ...(input.buttons === undefined ? {} : { buttons: input.buttons }),
          },
          schema: templateSchema,
          retry: false,
        });
        return {
          data,
          message: `Template '${data.name}' submitted (${data.providerStatus}). Approval usually takes minutes; check with check_status(templateId: "${data.id}").`,
        };
      }),
  );
};

export const registerTemplateTools = (server: McpServer): void => {
  registerCreateTemplate(server);
};
