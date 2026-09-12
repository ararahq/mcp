import { percentOf } from "./format.js";

export type CampaignCounts = {
  totalMessages: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  clickedCount?: number;
  replyCount?: number;
  convertedCount?: number;
  failedCount?: number;
};

export type FunnelStep = { key: string; label: string; count: number; percent: number };

const STEPS: ReadonlyArray<[keyof CampaignCounts, string, string]> = [
  ["sentCount", "sent", "Enviadas"],
  ["deliveredCount", "delivered", "Entregues"],
  ["readCount", "read", "Lidas"],
  ["clickedCount", "clicked", "Clicaram"],
  ["replyCount", "replied", "Responderam"],
  ["convertedCount", "converted", "Converteram"],
];

/** Funnel rows in order, each as count and percent of the audience. */
export const buildFunnel = (counts: CampaignCounts): FunnelStep[] =>
  STEPS.flatMap(([field, key, label]) => {
    const count = counts[field];
    if (typeof count !== "number") return [];
    return [{ key, label, count, percent: percentOf(count, counts.totalMessages) }];
  });

export const TERMINAL_STATUSES = new Set([
  "COMPLETED",
  "COMPLETED_WITH_ERRORS",
  "CANCELED",
  "FAILED",
]);

export const isCampaignRunning = (status: string): boolean =>
  !TERMINAL_STATUSES.has(status.toUpperCase());

export const humanizeCampaignStatus = (status: string): string => {
  const map: Record<string, string> = {
    INGESTING: "Preparando",
    SCHEDULED: "Agendada",
    SENDING: "Disparando",
    AB_TESTING: "Teste A/B",
    COMPLETED: "Concluída",
    COMPLETED_WITH_ERRORS: "Concluída com falhas",
    CANCELED: "Cancelada",
    FAILED: "Falhou",
  };
  return map[status.toUpperCase()] ?? status;
};

/** Share of the audience already sent, used for the live progress ring. */
export const progressPercent = (counts: CampaignCounts): number =>
  percentOf(counts.sentCount + (counts.failedCount ?? 0), counts.totalMessages);
