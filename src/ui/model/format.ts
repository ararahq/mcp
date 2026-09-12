const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const INTEGER = new Intl.NumberFormat("pt-BR");
const PERCENT_SCALE = 100;

export const formatBrl = (value: number): string => BRL.format(Number.isFinite(value) ? value : 0);

export const formatInteger = (value: number): string =>
  INTEGER.format(Number.isFinite(value) ? Math.round(value) : 0);

export const percentOf = (count: number, total: number): number =>
  total > 0 ? Math.round((count / total) * PERCENT_SCALE) : 0;

export const formatTime = (iso: string | null | undefined): string => {
  if (typeof iso !== "string") return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
};

export const formatDate = (iso: string | null | undefined): string => {
  if (typeof iso !== "string") return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
};

/** Replaces {{1}}, {{2}}... with positional values, leaving unknown slots visible. */
export const renderTemplateBody = (body: string, variables: readonly string[]): string =>
  body.replace(/\{\{(\d+)\}\}/g, (match, index: string) => {
    const value = variables[Number.parseInt(index, 10) - 1];
    return typeof value === "string" && value.length > 0 ? value : match;
  });
