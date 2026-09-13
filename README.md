# AraraHQ MCP

Official Model Context Protocol server for AraraHQ: talk to your whole WhatsApp base, see what came back, answer who replied.

Node.js is the only implementation, OAuth is the authentication boundary, and both the npm scope and public repository are owned by AraraHQ: [`@ararahq/mcp`](https://www.npmjs.com/package/@ararahq/mcp) and [`ararahq/mcp`](https://github.com/ararahq/mcp).

## What it exposes

Nine tools, on purpose. An agent works better with a few actions that accept what a person knows by heart (a name, a phone in any format) and resolve the rest.

| Tool                | What it does                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `whoami`            | Who is authenticated, which organization sends, plan and wallet balance.                                             |
| `send_whatsapp`     | One message to one person: free text inside the 24h window, or an approved template with variables any time.         |
| `broadcast`         | One approved template to up to 1000 people as a campaign. Dry run by default (preview and cost), A/B and scheduling. |
| `campaign_report`   | Recent campaigns, or the full report of one: sent, delivered, read, clicked, replied, converted, blocked, cost.      |
| `check_status`      | Did it arrive? Is the 24h window open? Was the template approved?                                                    |
| `create_template`   | Submit a template for Meta approval, with header, footer, samples and up to 2 buttons.                               |
| `save_contacts`     | Create or update up to 1000 contacts so you can message by name.                                                     |
| `opt_out`           | Record that someone asked to stop. Every later send to them is blocked.                                              |
| `read_conversation` | The raw message timeline with one person, newest first, so you can judge a reply before answering.                   |

Resources (`arara://organization`, `arara://templates/approved`, `arara://campaigns/recent`, `arara://channels`) give read-only context without a tool call. Prompts `plan_broadcast`, `campaign_review` and `reply_to_responses` package the three everyday flows and always stop for approval before a write.

Every tool returns both human-readable content and stable structured content. Write tools carry MCP safety annotations. Credentials never appear in tool inputs or output.

Operator tools (`create_api_key`, `list_api_keys`, `revoke_api_key`, `configure_webhook_route`, `list_templates`, `delete_template`, `template_health`, `list_failures`, `get_balance`, `add_credit`, `remove_credit`, `list_transactions`) exist for the AraraHQ team only and are gated server-side by an e-mail allowlist and an admin secret.

## Panels (MCP Apps)

Four tools ship an interactive panel that hosts with MCP Apps support (Claude Desktop, claude.ai, ChatGPT, VS Code) render inline. Every panel reads the same structured content the text fallback uses, so clients without panel support lose nothing.

| Tool                | Panel                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `campaign_report`   | Funnel with animated bars, headline numbers, block reasons, live refresh while sending.      |
| `broadcast`         | Phone mockup of the rendered message, audience and cost, approve button, then live delivery. |
| `check_status`      | Delivery timeline (accepted, sent, delivered, read) that polls until a final state.          |
| `read_conversation` | Chat thread with an inline reply box that calls `send_whatsapp`.                             |

Panels are single-file HTML bundles (about 15 KB each) built by `scripts/build-ui.mjs` into `build/ui/` and served as `ui://arara/<panel>.html` resources with the `text/html;profile=mcp-app` MIME type. They speak the MCP Apps protocol through a small postMessage bridge of their own (`src/ui/app/bridge.ts`), call tools through the host and hand follow-ups back to the chat; they never hold credentials.

## Local installation

Requires Node.js 20 or newer.

```bash
npx -y @ararahq/mcp login
npx -y @ararahq/mcp status
```

The device authorization flow opens AraraHQ in the browser. Access and refresh tokens are stored in the operating-system keychain, never in a project file or client configuration.

Configure an MCP client with stdio:

```json
{
  "mcpServers": {
    "ararahq": {
      "command": "npx",
      "args": ["-y", "@ararahq/mcp", "--stdio"]
    }
  }
}
```

Useful diagnostics:

```bash
npx -y @ararahq/mcp doctor
npx -y @ararahq/mcp tools
npx -y @ararahq/mcp logout
```

## Hosted transport

The hosted server uses stateless MCP Streamable HTTP at `POST /mcp`. It accepts OAuth bearer tokens only in the `Authorization` header. Query-string credentials, API-key tool arguments, legacy SSE endpoints, permissive CORS and debug endpoints do not exist.

One Web Standard handler (`src/transports/web.ts`) serves every runtime. Host and origin allowlists, the OAuth challenge, the protected resource metadata and the panel assets behave the same everywhere. The bearer is resolved to an identity once per minute per token (Cache API on Workers, memory on Node; only a token fingerprint and the name and e-mail are stored), and rate limits are counted per authenticated user, not per IP.

**Cloudflare Workers** is the production target. `wrangler.jsonc` declares the assets binding for the panels, a rate limiter and the public variables; the native keychain module is aliased to a stub so it never enters the bundle. A merge on `main` deploys through `.github/workflows/deploy.yml` once `CLOUDFLARE_API_TOKEN` exists.

```bash
npm run cf:dev      # wrangler dev on http://127.0.0.1:8787
npm run cf:deploy   # build + wrangler deploy to mcp.ararahq.com (and the workers.dev fallback)
```

**Node** remains available for local runs of the hosted mode. It is a thin Express adapter over the same handler:

```bash
MCP_TRANSPORT=http \
PORT=3333 \
MCP_PUBLIC_URL=https://mcp.ararahq.com/mcp \
MCP_ALLOWED_HOSTS=mcp.ararahq.com \
MCP_ALLOWED_ORIGINS=https://chatgpt.com,https://claude.ai \
ARARA_OAUTH_ISSUER=https://api.ararahq.com/api \
npm start
```

Protected Resource Metadata is served at:

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-protected-resource/mcp`

AraraHQ currently issues installed-client OAuth tokens through its device authorization flow. Hosted clients must supply a valid AraraHQ OAuth bearer token; the MCP does not proxy credentials or mint tokens.

## Behavior worth knowing

- `to` accepts a phone in any spelling or a saved contact name. Brazilian numbers get `+55` and the ninth digit when missing. An ambiguous name fails with the candidates instead of guessing.
- Free text outside the 24h window is refused by Meta. `send_whatsapp` turns that refusal into a list of your approved templates.
- `broadcast` never drops recipients silently: names that do not resolve are returned next to the campaign id.
- Message acceptance means queued, not delivered. Delivery is checked with `check_status`.
- Every mutating call carries an `Idempotency-Key`, so retries are safe.
- `broadcast` is a dry run unless `dryRun` is false. The preview resolves names, renders the template with the first contact's variables and calls the cost estimator, so approval happens with the real numbers.

## Development

```bash
npm ci
npm run check
npm audit --omit=dev
npm pack --dry-run
```

The server defaults to stdio. Use `MCP_TRANSPORT=http npm start` for Streamable HTTP. Override the API only for controlled environments with `ARARA_API_URL`.

The former unscoped package `ararahq-mcp` is the frozen v4 distribution. Version 5 was an Atendimento-oriented rewrite that never matched the product; version 6 is the broadcast-first server described here.

## Security

- OAuth tokens remain server-side and are redacted by design.
- External HTTP requests have explicit timeouts.
- Retries are limited to safe methods or requests carrying an idempotency key and honor `Retry-After`.
- All consumed API payloads are validated before fields are used.
- Hosted requests are rate-limited and checked against explicit host and origin allowlists.
- No telemetry is collected by this package.

Report vulnerabilities privately to `security@ararahq.com`.

## License

MIT © AraraHQ
