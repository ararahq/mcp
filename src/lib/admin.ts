import type { Method } from "axios";
import type { ZodType } from "zod";
import { apiRequest } from "./api.js";
import { AraraError } from "./errors.js";

type AdminRequestOptions<T> = {
  method?: Method;
  body?: unknown;
  schema: ZodType<T, unknown>;
  idempotencyKey?: string;
};

const requireAdminSecret = (): string => {
  const secret = process.env.ARARA_ADMIN_SECRET;
  if (typeof secret !== "string" || secret.length === 0) {
    throw new AraraError(
      "ADMIN_NOT_CONFIGURED",
      "Admin-gated tools require ARARA_ADMIN_SECRET in the MCP server environment.",
      403,
      false,
    );
  }
  return secret;
};

/**
 * Thin wrapper over apiRequest for /v1/admin/** endpoints: the session Bearer token
 * satisfies the hasRole(ADMIN) gate in SecurityConfig, and X-Admin-Secret is the
 * second layer checked by the controller. The secret lives only in the server
 * process environment and is attached as a header — never in inputs, outputs or
 * error messages. Retry/backoff and Idempotency-Key come from apiRequest.
 */
export const adminRequest = async <T>(path: string, options: AdminRequestOptions<T>): Promise<T> =>
  apiRequest(path, {
    body: options.body,
    schema: options.schema,
    extraHeaders: { "X-Admin-Secret": requireAdminSecret() },
    ...(options.method === undefined ? {} : { method: options.method }),
    ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
  });
