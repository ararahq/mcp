import axios from "axios";
import { createWebHandler } from "./transports/web.js";
import { policyFromEnv } from "./transports/policy.js";
import type { UiPanel } from "./ui/resources.js";

type AssetFetcher = { fetch: (input: string | Request) => Promise<Response> };
type RateLimiter = { limit: (options: { key: string }) => Promise<{ success: boolean }> };

export type WorkerEnv = Record<string, string | undefined> & {
  ASSETS: AssetFetcher;
  RATE_LIMITER?: RateLimiter;
};

const ASSET_ORIGIN = "https://assets.local";
const FALLBACK_HTML = "<!doctype html><p>Panel asset missing.</p>";

axios.defaults.adapter = "fetch";

const loadPanelFromAssets =
  (assets: AssetFetcher) =>
  async (panel: UiPanel): Promise<string> => {
    const response = await assets.fetch(`${ASSET_ORIGIN}/${panel}.html`);
    return response.ok ? response.text() : FALLBACK_HTML;
  };

const clientKey = (request: Request): string =>
  request.headers.get("cf-connecting-ip") ?? "anonymous";

const rateLimiterFor =
  (limiter: RateLimiter | undefined) =>
  async (request: Request): Promise<boolean> => {
    if (limiter === undefined) return false;
    const { success } = await limiter.limit({ key: clientKey(request) });
    return !success;
  };

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const handler = createWebHandler({
      policy: policyFromEnv(env),
      loadPanel: loadPanelFromAssets(env.ASSETS),
      isRateLimited: rateLimiterFor(env.RATE_LIMITER),
    });
    return handler(request);
  },
};
