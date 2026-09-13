import axios from "axios";
import { createWebHandler } from "./transports/web.js";
import {
  IDENTITY_CACHE_TTL_SECONDS,
  policyFromEnv,
  type Identity,
  type IdentityCache,
} from "./transports/policy.js";
import type { UiPanel } from "./ui/resources.js";

type AssetFetcher = { fetch: (input: string | Request) => Promise<Response> };
type RateLimiter = { limit: (options: { key: string }) => Promise<{ success: boolean }> };
type EdgeCache = {
  match: (key: string) => Promise<Response | undefined>;
  put: (key: string, response: Response) => Promise<void>;
};

export type WorkerEnv = Record<string, string | undefined> & {
  ASSETS: AssetFetcher;
  RATE_LIMITER?: RateLimiter;
};

const ASSET_ORIGIN = "https://assets.local";
const IDENTITY_CACHE_ORIGIN = "https://identity-cache.local";
const FALLBACK_HTML = "<!doctype html><p>Panel asset missing.</p>";

axios.defaults.adapter = "fetch";

const loadPanelFromAssets =
  (assets: AssetFetcher) =>
  async (panel: UiPanel): Promise<string> => {
    const response = await assets.fetch(`${ASSET_ORIGIN}/${panel}.html`);
    return response.ok ? response.text() : FALLBACK_HTML;
  };

/**
 * Identity cache on the Workers Cache API: the key is a synthetic URL carrying
 * only the token fingerprint, and the entry carries only name and e-mail.
 */
const edgeIdentityCache = (cache: EdgeCache): IdentityCache => ({
  get: async (key) => {
    const hit = await cache.match(`${IDENTITY_CACHE_ORIGIN}/${key}`);
    if (hit === undefined) return undefined;
    return (await hit.json()) as Identity;
  },
  set: (key, identity) =>
    cache.put(
      `${IDENTITY_CACHE_ORIGIN}/${key}`,
      new Response(JSON.stringify(identity), {
        headers: {
          "content-type": "application/json",
          "cache-control": `max-age=${IDENTITY_CACHE_TTL_SECONDS}`,
        },
      }),
    ),
});

const rateLimiterFor =
  (limiter: RateLimiter | undefined) =>
  async (userKey: string): Promise<boolean> => {
    if (limiter === undefined) return false;
    const { success } = await limiter.limit({ key: userKey });
    return !success;
  };

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const handler = createWebHandler({
      policy: policyFromEnv(env),
      loadPanel: loadPanelFromAssets(env.ASSETS),
      identityCache: edgeIdentityCache((caches as unknown as { default: EdgeCache }).default),
      isRateLimited: rateLimiterFor(env.RATE_LIMITER),
    });
    return handler(request);
  },
};
