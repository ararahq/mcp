export type TimelineStep = {
  key: string;
  label: string;
  state: "done" | "current" | "pending" | "failed";
};

const ORDER = ["accepted", "sent", "delivered", "read"] as const;
const LABELS: Record<(typeof ORDER)[number], string> = {
  accepted: "Aceita",
  sent: "Enviada",
  delivered: "Entregue",
  read: "Lida",
};

const STATUS_RANK: Record<string, number> = {
  PENDING: 0,
  QUEUED: 0,
  ACCEPTED: 0,
  SENT: 1,
  SENT_TO_PROVIDER: 1,
  ENVIADA: 1,
  DELIVERED: 2,
  ENTREGUE: 2,
  READ: 3,
  LIDA: 3,
};

export const isFailedStatus = (status: string): boolean =>
  /FAIL|ERRO|REJECT|UNDELIVER/i.test(status);

export const isTerminalStatus = (status: string): boolean =>
  isFailedStatus(status) || STATUS_RANK[status.toUpperCase()] === 3;

/** Maps a provider status to the four visual steps of a delivery timeline. */
export const buildTimeline = (status: string): TimelineStep[] => {
  const normalized = status.toUpperCase();
  const failed = isFailedStatus(normalized);
  const rank = STATUS_RANK[normalized] ?? 0;
  return ORDER.map((key, index) => {
    if (failed)
      return {
        key,
        label: LABELS[key],
        state: index === 0 ? "done" : index === 1 ? "failed" : "pending",
      };
    if (index < rank) return { key, label: LABELS[key], state: "done" };
    if (index === rank) return { key, label: LABELS[key], state: rank === 3 ? "done" : "current" };
    return { key, label: LABELS[key], state: "pending" };
  });
};

export const humanizeMessageStatus = (status: string): string => {
  if (isFailedStatus(status)) return "Falhou";
  const rank = STATUS_RANK[status.toUpperCase()];
  if (rank === undefined) return status;
  return LABELS[ORDER[rank] ?? "accepted"];
};
