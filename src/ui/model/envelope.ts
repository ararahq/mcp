export type ToolEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Reads the MCP structured content of any Arara tool into a typed envelope. */
export const readEnvelope = <T>(structuredContent: unknown): ToolEnvelope<T> => {
  if (!isRecord(structuredContent)) {
    return {
      ok: false,
      error: { code: "EMPTY_RESULT", message: "Sem dados na resposta.", retryable: false },
    };
  }
  if (structuredContent.ok === true) return { ok: true, data: structuredContent.data as T };
  const error = isRecord(structuredContent.error) ? structuredContent.error : {};
  return {
    ok: false,
    error: {
      code: typeof error.code === "string" ? error.code : "UNKNOWN",
      message: typeof error.message === "string" ? error.message : "Algo deu errado.",
      retryable: error.retryable === true,
    },
  };
};
