import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MAX_PAGE_SIZE } from "../config.js";
import { apiRequest } from "../lib/api.js";
import {
  automationDefinitionSchema,
  automationDefinitionShape,
  automationPageSchema,
  automationPricingSchema,
  automationSchema,
  automationsSchema,
  automationTemplateOptionsSchema,
  emptyResponseSchema,
  explainAutomationError,
  hookSignatureSchema,
  withoutSecrets,
} from "../lib/automations.js";
import { AraraError } from "../lib/errors.js";
import { execute } from "../mcp/result.js";
import { destructive, idempotentWrite, readOnly, register, write } from "./register.js";

const READ_PERMISSION = "READ";
const MANAGE_PERMISSION = "AUTOMATIONS_MANAGE";
const DEFAULT_RUNS_PAGE_SIZE = 20;
const DEFAULT_EVENTS_PAGE_SIZE = 50;
const BASE_PATH = "/v1/automations";

const idSchema = z.string().uuid();
const pageSchema = z.number().int().nonnegative().default(0);
const sizeSchema = z.number().int().min(1).max(MAX_PAGE_SIZE).optional();

const SHAPE_GUIDE = [
  "Shape: {name, trigger, triggerConfig?, steps}. All wire values are lowercase.",
  "Triggers: webhook, cart.abandoned, payment.failed, tag.applied, conversation.started, button.replied, charge.paid, charge.expired.",
  "A step is {type, config, branches?}. Types: message {templateId, variables[]} or {sessionText} ({sessionText, chargeFromRun:true} sends the charge that came with the trigger); wait {minutes}; condition {tag}; tag {tag}; question {mode:'buttons'|'list'|'template', text, buttonText? (list only), options:[{id,title,match[]}], timeoutMinutes, retryText?, templateName?/templateId?/variables? (template mode)} with branches keyed by option id plus '__timeout' and '__other'; wait_payment {timeoutMinutes} with branches 'paid' and 'unpaid'.",
  "Hard rules: at most 2 levels of branching steps (question / wait_payment inside a branch counts as level 2); buttons take up to 3 options with title up to 20 chars; list takes up to 10 options with title up to 24 chars; sessionText and question modes 'buttons'/'list' only reach people inside the 24h WhatsApp window, so the FIRST message to someone outside it must be a template message or a question in 'template' mode. Pick templateId from list_automation_templates.",
  'Example: {"name":"Carrinho","trigger":"cart.abandoned","steps":[{"type":"wait","config":{"minutes":30}},{"type":"question","config":{"mode":"template","templateName":"carrinho_lembrete","variables":["{{name}}"],"text":"Ainda quer o pedido?","options":[{"id":"sim","title":"Quero","match":["sim","quero"]},{"id":"nao","title":"Agora nao","match":["nao"]}],"timeoutMinutes":1440},"branches":{"sim":[{"type":"message","config":{"sessionText":"Segue o link: https://loja.example/checkout"}}],"nao":[{"type":"tag","config":{"tag":"sem-interesse"}}],"__timeout":[{"type":"tag","config":{"tag":"sem-resposta"}}]}}]}.',
  "When the API refuses the payload it answers with a sentence saying what to fix; correct the payload and call again.",
].join(" ");

const invalidInput = (error: z.ZodError): AraraError => {
  const details = error.issues
    .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
    .join("; ");
  return new AraraError("INVALID_INPUT", details, 400, false);
};

const parseInput = <T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): T => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalidInput(parsed.error);
  return parsed.data;
};

const run = (permission: string, task: () => Promise<{ data: unknown; message: string }>) =>
  execute(async () => {
    try {
      return await task();
    } catch (error) {
      throw explainAutomationError(error, permission);
    }
  });

const registerListAutomations = (server: McpServer): void => {
  register(
    server,
    "list_automations",
    "List every automation of the organization with trigger, steps, whether it is active, cost per run in BRL and run stats (last 30 days, in flight, completed, stopped). Trigger URLs are credentials and are left out here; use get_automation for them.",
    {},
    readOnly,
    async () =>
      run(READ_PERMISSION, async () => {
        const automations = await apiRequest(BASE_PATH, { schema: automationsSchema });
        const active = automations.filter((automation) => automation.active).length;
        return {
          data: automations.map(withoutSecrets),
          message: `${automations.length} automation(s), ${active} active.`,
        };
      }),
  );
};

const registerGetAutomation = (server: McpServer): void => {
  register(
    server,
    "get_automation",
    "Full detail of one automation, including its trigger URLs ('hook.url' and 'webhookUrl'). Those URLs carry a token: they are SECRETS meant to be pasted into the user's own system (store, checkout, n8n). Hand them to the user only when asked, never put them in other tool calls, logs or summaries. The signing secret is never returned here, only 'hasSecret'.",
    { automationId: idSchema },
    readOnly,
    async (input) =>
      run(READ_PERMISSION, async () => {
        const id = parseInput(idSchema, input.automationId);
        const data = await apiRequest(`${BASE_PATH}/${id}`, { schema: automationSchema });
        return {
          data,
          message: `Automation '${data.name}' [${data.active ? "active" : "inactive"}], trigger ${data.trigger}, ${String(data.costPerRunBrl)} BRL per run. Trigger URLs in the result are secrets.`,
        };
      }),
  );
};

const registerListAutomationTemplates = (server: McpServer): void => {
  register(
    server,
    "list_automation_templates",
    "Approved templates an automation step may use, each with 'unitPriceBrl' and 'hasChargeButton', plus 'sessionUnitPriceBrl' (price of a free-text, buttons or list message). Use it to pick 'templateId' and to tell the user the cost before building.",
    {},
    readOnly,
    async () =>
      run(READ_PERMISSION, async () => {
        const [templates, pricing] = await Promise.all([
          apiRequest(`${BASE_PATH}/templates`, { schema: automationTemplateOptionsSchema }),
          apiRequest(`${BASE_PATH}/pricing`, { schema: automationPricingSchema }),
        ]);
        return {
          data: { templates, sessionUnitPriceBrl: pricing.sessionUnitPriceBrl },
          message: `${templates.length} approved template(s). Session message costs ${String(pricing.sessionUnitPriceBrl)} BRL.`,
        };
      }),
  );
};

const registerCreateAutomation = (server: McpServer): void => {
  register(
    server,
    "create_automation",
    `Create an automation. It is always born INACTIVE and this tool never activates it: nothing is sent until the user approves set_automation_active. ${SHAPE_GUIDE}`,
    automationDefinitionShape,
    write,
    async (input) =>
      run(MANAGE_PERMISSION, async () => {
        const body = parseInput(automationDefinitionSchema, input);
        const data = await apiRequest(BASE_PATH, {
          method: "POST",
          body,
          schema: automationSchema,
          retry: false,
        });
        return {
          data: withoutSecrets(data),
          message: `Automation '${data.name}' created INACTIVE, ${String(data.costPerRunBrl)} BRL per run. Show the user the flow and the cost, then use set_automation_active to turn it on.`,
        };
      }),
  );
};

const registerUpdateAutomation = (server: McpServer): void => {
  register(
    server,
    "update_automation",
    `Replace the whole definition of an automation (name, trigger, triggerConfig and steps are all overwritten, so send the complete flow). It does not change whether the automation is active; editing an active one changes what real customers receive, so confirm with the user first. ${SHAPE_GUIDE}`,
    { automationId: idSchema, ...automationDefinitionShape },
    idempotentWrite,
    async (input) =>
      run(MANAGE_PERMISSION, async () => {
        const id = parseInput(idSchema, input.automationId);
        const body = parseInput(automationDefinitionSchema, input);
        const data = await apiRequest(`${BASE_PATH}/${id}`, {
          method: "PUT",
          body,
          schema: automationSchema,
          retry: false,
        });
        return {
          data: withoutSecrets(data),
          message: `Automation '${data.name}' updated [${data.active ? "active" : "inactive"}], ${String(data.costPerRunBrl)} BRL per run.`,
        };
      }),
  );
};

const previewActivation = async (id: string) => {
  const data = await apiRequest(`${BASE_PATH}/${id}`, { schema: automationSchema });
  return {
    data: { preview: true, automation: withoutSecrets(data) },
    message: `Preview only, nothing changed. Activating '${data.name}' (trigger ${data.trigger}) sends paid messages to real customers, about ${String(data.costPerRunBrl)} BRL per person who enters. Call set_automation_active again with dryRun=false after the user approves.`,
  };
};

const applyActive = async (id: string, active: boolean) => {
  const data = await apiRequest(`${BASE_PATH}/${id}/active`, {
    method: "PUT",
    body: { active },
    schema: automationSchema,
    retry: false,
  });
  return {
    data: withoutSecrets(data),
    message: `Automation '${data.name}' is now ${data.active ? "ACTIVE: every new trigger sends messages and spends balance" : "inactive: no new runs start"}.`,
  };
};

const registerSetAutomationActive = (server: McpServer): void => {
  register(
    server,
    "set_automation_active",
    "Turn an automation on or off. Turning ON makes real, paid WhatsApp messages go out to customers on every trigger, so with active=true it is a dry run by default: it returns the flow and the cost per run for the user to approve, and only activates when called again with dryRun=false. Turning off (active=false) applies immediately and only stops new runs. The plan limits how many automations can be active.",
    { automationId: idSchema, active: z.boolean(), dryRun: z.boolean().default(true) },
    destructive,
    async (input) =>
      run(MANAGE_PERMISSION, async () => {
        const id = parseInput(idSchema, input.automationId);
        const active = parseInput(z.boolean(), input.active);
        return active && input.dryRun !== false ? previewActivation(id) : applyActive(id, active);
      }),
  );
};

const previewDelete = async (id: string) => {
  const data = await apiRequest(`${BASE_PATH}/${id}`, { schema: automationSchema });
  return {
    data: { preview: true, automation: withoutSecrets(data) },
    message: `Preview only, nothing deleted. Deleting '${data.name}' [${data.active ? "active" : "inactive"}] is permanent: the flow, its trigger URL and its runs stop existing. Call delete_automation again with dryRun=false after the user approves.`,
  };
};

const registerDeleteAutomation = (server: McpServer): void => {
  register(
    server,
    "delete_automation",
    "Permanently delete an automation. Dry run by default: it shows what would be removed (name, active state, stats) and deletes only when called again with dryRun=false after the user approves. To just stop it, prefer set_automation_active with active=false.",
    { automationId: idSchema, dryRun: z.boolean().default(true) },
    destructive,
    async (input) =>
      run(MANAGE_PERMISSION, async () => {
        const id = parseInput(idSchema, input.automationId);
        if (input.dryRun !== false) return previewDelete(id);
        await apiRequest(`${BASE_PATH}/${id}`, {
          method: "DELETE",
          schema: emptyResponseSchema,
          retry: false,
        });
        return { data: { deleted: true, automationId: id }, message: `Automation ${id} deleted.` };
      }),
  );
};

const registerListAutomationRuns = (server: McpServer): void => {
  register(
    server,
    "list_automation_runs",
    "Who went through an automation. Without 'runId' it lists runs (phone, status RUNNING / WAITING_REPLY / COMPLETED / STOPPED / FAILED, stoppedReason), newest first. With 'runId' it returns the event trail of that run, which answers 'why did this person stop here?'. Both are paginated.",
    { automationId: idSchema, runId: idSchema.optional(), page: pageSchema, size: sizeSchema },
    readOnly,
    async (input) =>
      run(READ_PERMISSION, async () => {
        const id = parseInput(idSchema, input.automationId);
        const runId = parseInput(idSchema.optional(), input.runId);
        const page = parseInput(pageSchema, input.page);
        const fallback = runId === undefined ? DEFAULT_RUNS_PAGE_SIZE : DEFAULT_EVENTS_PAGE_SIZE;
        const size = parseInput(sizeSchema, input.size) ?? fallback;
        const params = new URLSearchParams({ page: String(page), size: String(size) });
        const path = runId === undefined ? "runs" : `runs/${runId}/events`;
        const data = await apiRequest(`${BASE_PATH}/${id}/${path}?${params.toString()}`, {
          schema: automationPageSchema,
        });
        const noun = runId === undefined ? "run(s)" : "event(s)";
        return {
          data,
          message: `${data.data.length} ${noun} on page ${page} of ${data.pagination.totalPages}.`,
        };
      }),
  );
};

const HOOK_ACTIONS = ["regenerate_url", "enable_signature", "disable_signature"] as const;
const hookActionSchema = z.enum(HOOK_ACTIONS);

const regenerateHook = async (id: string) => {
  await apiRequest(`${BASE_PATH}/${id}/hook/regenerate`, {
    method: "POST",
    schema: emptyResponseSchema,
    retry: false,
  });
  return {
    data: { regenerated: true, automationId: id },
    message:
      "Trigger URL regenerated; the old URL stopped working. Read the new one with get_automation and hand it to the user.",
  };
};

const setHookSignature = async (id: string, enabled: boolean) => {
  const data = await apiRequest(`${BASE_PATH}/${id}/hook/signature`, {
    method: "PUT",
    body: { enabled },
    schema: hookSignatureSchema,
    retry: false,
  });
  const secret = enabled && typeof data.secret === "string" ? { secret: data.secret } : {};
  return {
    data: { signatureEnabled: data.signatureEnabled, hasSecret: data.hasSecret, ...secret },
    message: enabled
      ? "Signature enabled. The signing secret in this result is SHOWN ONCE and cannot be read again: give it to the user now so they store it in their system, and do not repeat it anywhere else."
      : "Signature disabled. Calls to the trigger URL are no longer verified.",
  };
};

const registerManageAutomationHook = (server: McpServer): void => {
  register(
    server,
    "manage_automation_hook",
    "Security of the trigger URL of a 'webhook' automation. action='regenerate_url' swaps the token (the old URL stops working at once, breaking whatever the user already connected); 'enable_signature' turns on HMAC signing and returns the signing secret ONCE, in this single result; 'disable_signature' turns it off. Dry run by default: it only describes the effect; call again with dryRun=false after the user approves.",
    { automationId: idSchema, action: hookActionSchema, dryRun: z.boolean().default(true) },
    destructive,
    async (input) =>
      run(MANAGE_PERMISSION, async () => {
        const id = parseInput(idSchema, input.automationId);
        const action = parseInput(hookActionSchema, input.action);
        if (input.dryRun !== false) {
          return {
            data: { preview: true, automationId: id, action },
            message: `Preview only, nothing changed. '${action}' affects the integration the user already connected to this automation. Call again with dryRun=false after the user approves.`,
          };
        }
        return action === "regenerate_url"
          ? regenerateHook(id)
          : setHookSignature(id, action === "enable_signature");
      }),
  );
};

export const AUTOMATION_TOOL_NAMES = [
  "list_automations",
  "get_automation",
  "list_automation_templates",
  "create_automation",
  "update_automation",
  "set_automation_active",
  "delete_automation",
  "list_automation_runs",
  "manage_automation_hook",
] as const;

export const registerAutomationTools = (server: McpServer): void => {
  registerListAutomations(server);
  registerGetAutomation(server);
  registerListAutomationTemplates(server);
  registerCreateAutomation(server);
  registerUpdateAutomation(server);
  registerSetAutomationActive(server);
  registerDeleteAutomation(server);
  registerListAutomationRuns(server);
  registerManageAutomationHook(server);
};
