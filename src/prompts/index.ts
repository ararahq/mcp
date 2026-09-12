import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const prompt = (text: string) => ({
  messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
});

export const registerAllPrompts = (server: McpServer): void => {
  server.registerPrompt(
    "plan_broadcast",
    { description: "Prepare a broadcast and ask for approval before sending." },
    () =>
      prompt(
        "Call whoami to confirm the organization and balance. Read arara://templates/approved and pick the template that fits the goal, or propose one with create_template if none fits. Call broadcast in its default dry-run mode to render the message, resolve the audience and estimate the cost, and show that preview. Only call broadcast with dryRun=false after the user explicitly approves.",
      ),
  );
  server.registerPrompt(
    "campaign_review",
    { description: "Read the results of a campaign and say what to do next." },
    () =>
      prompt(
        "Call campaign_report without an id to find the campaign, then with its id for the full report. Summarize delivery, reads, clicks, replies and conversions as percentages of the audience, explain blocked and refunded rows, and recommend one next action: reply to responders, re-send to the unread with another template, or stop.",
      ),
  );
  server.registerPrompt(
    "reply_to_responses",
    { description: "Answer people who replied to a broadcast." },
    () =>
      prompt(
        "Use read_conversation to read what the person wrote. Draft a short reply consistent with the campaign and the conversation so far. If they asked to stop, call opt_out instead of replying. Do not call send_whatsapp until the user approves the exact text.",
      ),
  );
};
