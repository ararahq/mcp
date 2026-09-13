import express, { type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { getHttpPort, SERVER_VERSION } from "../config.js";
import { loadPanelFromDisk } from "../ui/panel-files.js";
import { policyFromEnv } from "./policy.js";
import { createWebHandler } from "./web.js";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_PER_WINDOW = 120;
const BODY_LIMIT = "64kb";

/** Rebuilds a Web Standard Request from the Express one, honoring the proxy protocol. */
const toWebRequest = (request: Request): globalThis.Request => {
  const protocol = request.header("x-forwarded-proto") ?? request.protocol;
  const url = `${protocol}://${request.get("host") ?? "localhost"}${request.originalUrl}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const body: unknown = request.body;
  const init: RequestInit & { duplex?: "half" } = { method: request.method, headers };
  if (hasBody && typeof body === "string") {
    init.body = body;
    init.duplex = "half";
  }
  return new globalThis.Request(url, init);
};

const sendWebResponse = async (webResponse: globalThis.Response, response: Response) => {
  response.status(webResponse.status);
  webResponse.headers.forEach((value, key) => response.setHeader(key, value));
  if (webResponse.body === null) {
    response.end();
    return;
  }
  const reader = webResponse.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    response.write(value);
  }
  response.end();
};

/**
 * Node runtime for the hosted server (the EC2 path). It is a thin adapter over the
 * same Web Standard handler the Workers runtime uses, so both behave identically.
 */
export const runHttp = async (): Promise<void> => {
  const handler = createWebHandler({
    policy: policyFromEnv(process.env),
    loadPanel: loadPanelFromDisk(),
  });
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.text({ type: "application/json", limit: BODY_LIMIT }));
  app.use(
    rateLimit({
      windowMs: RATE_LIMIT_WINDOW_MS,
      limit: RATE_LIMIT_PER_WINDOW,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.all("*", (request, response) => {
    handler(toWebRequest(request))
      .then((webResponse) => sendWebResponse(webResponse, response))
      .catch(() => {
        if (!response.headersSent) {
          response
            .status(500)
            .json({ error: { code: "INTERNAL_ERROR", message: "Request failed." } });
        }
      });
  });
  const port = getHttpPort();
  await new Promise<void>((resolve, reject) => {
    const listener = app.listen(port, () => {
      process.stderr.write(`AraraHQ MCP ${SERVER_VERSION} listening on ${port}.\n`);
      resolve();
    });
    listener.on("error", reject);
  });
};
