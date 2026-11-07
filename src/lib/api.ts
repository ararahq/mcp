import axios, { type Method } from "axios";
import type { ZodType } from "zod";
import { API_TIMEOUT_MS, getApiBaseUrl, MAX_RETRIES } from "../config.js";
import { getAccessToken } from "../auth/tokens.js";
import { AraraError, toAraraError } from "./errors.js";

type RequestOptions<T> = {
  method?: Method;
  body?: unknown;
  schema: ZodType<T, unknown>;
  idempotencyKey?: string;
  retry?: boolean;
  /** Extra headers merged into the request (e.g. X-Admin-Secret). Never logged or echoed. */
  extraHeaders?: Record<string, string>;
};

const wait = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const canRetry = (method: Method, idempotencyKey: string | undefined): boolean =>
  ["GET", "HEAD", "PUT", "DELETE", "OPTIONS"].includes(method.toUpperCase()) ||
  idempotencyKey !== undefined;

export const apiRequest = async <T>(path: string, options: RequestOptions<T>): Promise<T> => {
  const token = await getAccessToken();
  const method = options.method ?? "GET";
  const retryAllowed = (options.retry ?? true) && canRetry(method, options.idempotencyKey);
  let attempt = 0;

  while (true) {
    try {
      const response = await axios.request<unknown>({
        baseURL: getApiBaseUrl(),
        url: path,
        method,
        data: options.body,
        timeout: API_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(options.idempotencyKey === undefined
            ? {}
            : { "Idempotency-Key": options.idempotencyKey }),
          ...options.extraHeaders,
        },
      });
      const parsed = options.schema.safeParse(response.data);
      if (!parsed.success) {
        throw new AraraError(
          "INVALID_API_RESPONSE",
          "AraraHQ API returned an unexpected response.",
          502,
          false,
        );
      }
      return parsed.data;
    } catch (error) {
      const normalized = toAraraError(error);
      if (!retryAllowed || !normalized.retryable || attempt >= MAX_RETRIES) throw normalized;
      const delay =
        normalized.retryAfterSeconds !== undefined
          ? normalized.retryAfterSeconds * 1_000
          : 250 * 2 ** attempt + Math.floor(Math.random() * 100);
      attempt += 1;
      await wait(Math.min(delay, 10_000));
    }
  }
};
