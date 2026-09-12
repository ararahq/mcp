import "./panel.css";
import {
  humanizeCampaignStatus,
  isCampaignRunning,
  progressPercent,
  type CampaignCounts,
} from "../model/campaign.js";
import type { ToolEnvelope } from "../model/envelope.js";
import { formatBrl, formatInteger, formatTime } from "../model/format.js";
import { bootPanel, countUp, errorBox, h, replace, skeleton, sleep, type Panel } from "./shared.js";

const POLL_MS = 4000;
const MAX_POLLS = 90;
const MAX_UNRESOLVED_SHOWN = 5;

type Preview = {
  preview: true;
  templateName: string;
  renderedBody: string;
  buttons: string[];
  recipients: number;
  unresolved: string[];
  totalCost: number;
  unitPrice: number;
  category: string;
  abTest?:
    { variantBTemplateName: string; samplePct: number; decisionWindowMinutes: number } | undefined;
  scheduledAt?: string | undefined;
  request: Record<string, unknown>;
};
type Accepted = {
  id: string;
  name: string;
  status: string;
  totalMessages: number;
  totalCost: number;
  renderedBody?: string;
  buttons?: string[];
  unresolved: string[];
};
type Progress = CampaignCounts & { id: string; name: string; status: string; totalCost: number };
type Result = Preview | Accepted;

const phone = (body: string, buttons: string[]): HTMLElement =>
  h(
    "div",
    { class: "phone-wrap" },
    h(
      "div",
      { class: "phone" },
      h("div", { class: "bar-top" }, "WhatsApp · agora"),
      h(
        "div",
        { class: "bubble" },
        body,
        h("span", { class: "t" }, formatTime(new Date().toISOString())),
      ),
      ...buttons.map((label) => h("div", { class: "wa-btn" }, label)),
    ),
  );

const unresolvedNote = (unresolved: string[]): HTMLElement | null => {
  if (unresolved.length === 0) return null;
  const shown = unresolved.slice(0, MAX_UNRESOLVED_SHOWN).join(", ");
  const more =
    unresolved.length > MAX_UNRESOLVED_SHOWN
      ? ` e mais ${unresolved.length - MAX_UNRESOLVED_SHOWN}`
      : "";
  return h("p", { class: "note" }, `Não resolvi ${unresolved.length}: ${shown}${more}.`);
};

const renderPreview = (panel: Panel, preview: Preview): void => {
  const ab = preview.abTest;
  const when =
    typeof preview.scheduledAt === "string" ? `agendado ${preview.scheduledAt}` : "agora";
  const approve = h(
    "button",
    {
      class: "primary",
      onclick: () => {
        approve.setAttribute("disabled", "");
        approve.textContent = "Disparando…";
        void fire(panel, preview);
      },
    },
    "Aprovar e disparar",
  );
  replace(
    panel.root,
    h(
      "div",
      { class: "panel" },
      h(
        "div",
        { class: "head" },
        h(
          "div",
          {},
          h("p", { class: "eyebrow" }, "disparo · prévia"),
          h(
            "h1",
            { class: "title" },
            `${preview.templateName} para ${formatInteger(preview.recipients)} pessoas`,
          ),
          h(
            "p",
            { class: "sub" },
            `${preview.category} · ${formatBrl(preview.unitPrice)} por mensagem · ${when}`,
          ),
        ),
        h("span", { class: "pill warn" }, "aguardando aprovação"),
      ),
      phone(preview.renderedBody, preview.buttons),
      h(
        "div",
        { class: "metrics" },
        h(
          "div",
          { class: "metric" },
          h("p", { class: "k" }, "Válidos"),
          h("p", { class: "v" }, formatInteger(preview.recipients)),
        ),
        h(
          "div",
          { class: "metric" },
          h("p", { class: "k" }, "Custo estimado"),
          h("p", { class: "v accent" }, formatBrl(preview.totalCost)),
        ),
        ab === undefined
          ? h(
              "div",
              { class: "metric" },
              h("p", { class: "k" }, "Teste A/B"),
              h("p", { class: "v" }, "não"),
            )
          : h(
              "div",
              { class: "metric" },
              h("p", { class: "k" }, `A/B vs ${ab.variantBTemplateName}`),
              h("p", { class: "v" }, `${ab.samplePct}% · ${ab.decisionWindowMinutes}min`),
            ),
      ),
      unresolvedNote(preview.unresolved),
      h(
        "div",
        { class: "actions" },
        approve,
        h(
          "button",
          {
            onclick: () =>
              void panel.ask("Quero ajustar a audiência desse disparo antes de aprovar."),
          },
          "Editar audiência",
        ),
        h(
          "button",
          { onclick: () => void panel.ask("Troca o template desse disparo por outro aprovado.") },
          "Trocar template",
        ),
      ),
    ),
  );
};

const fire = async (panel: Panel, preview: Preview): Promise<void> => {
  const result = await panel.callTool<Accepted>("broadcast", { ...preview.request, dryRun: false });
  if (!result.ok) {
    replace(panel.root, h("div", { class: "panel" }, errorBox(result.error.message)));
    return;
  }
  renderLive(panel, {
    ...result.data,
    renderedBody: preview.renderedBody,
    buttons: preview.buttons,
  });
};

const progressRow = (label: string, count: number, total: number, soft: boolean): HTMLElement => {
  const fill = h("i", { class: soft ? "soft" : "" });
  requestAnimationFrame(() => {
    fill.style.width = `${total > 0 ? Math.round((count / total) * 100) : 0}%`;
  });
  return h(
    "div",
    { class: "row" },
    h("span", { class: "lbl" }, label),
    h("div", { class: "bar" }, fill),
    h("span", { class: "num" }, h("b", {}, formatInteger(count)), ` / ${formatInteger(total)}`),
  );
};

const renderLive = (panel: Panel, accepted: Accepted, progress?: Progress, polls = 0): void => {
  const status = progress?.status ?? accepted.status;
  const running = isCampaignRunning(status);
  const counts: CampaignCounts = progress ?? {
    totalMessages: accepted.totalMessages,
    sentCount: 0,
    deliveredCount: 0,
    readCount: 0,
  };
  const percent = h("p", { class: "v accent" }, "0");
  countUp(percent, progressPercent(counts), (n) => `${Math.round(n)}%`);
  replace(
    panel.root,
    h(
      "div",
      { class: "panel" },
      h(
        "div",
        { class: "head" },
        h(
          "div",
          {},
          h("p", { class: "eyebrow" }, running ? "disparo · ao vivo" : "disparo"),
          h("h1", { class: "title" }, accepted.name),
          h(
            "p",
            { class: "sub" },
            `${formatInteger(accepted.totalMessages)} pessoas · ${formatBrl(accepted.totalCost)}`,
          ),
        ),
        h(
          "span",
          { class: `pill ${running ? "live" : "ok"}` },
          h("i", { class: `dot ${running ? "pulse" : ""}` }),
          humanizeCampaignStatus(status),
        ),
      ),
      typeof accepted.renderedBody === "string"
        ? phone(accepted.renderedBody, accepted.buttons ?? [])
        : null,
      h(
        "div",
        { class: "metrics" },
        h("div", { class: "metric" }, h("p", { class: "k" }, "Saiu da fila"), percent),
        h(
          "div",
          { class: "metric" },
          h("p", { class: "k" }, "Entregues"),
          h("p", { class: "v" }, formatInteger(counts.deliveredCount)),
        ),
        h(
          "div",
          { class: "metric" },
          h("p", { class: "k" }, "Lidas"),
          h("p", { class: "v" }, formatInteger(counts.readCount)),
        ),
      ),
      h(
        "div",
        { class: "funnel" },
        progressRow("Enviadas", counts.sentCount, counts.totalMessages, true),
        progressRow("Entregues", counts.deliveredCount, counts.totalMessages, true),
        progressRow("Lidas", counts.readCount, counts.totalMessages, false),
      ),
      unresolvedNote(accepted.unresolved),
      h(
        "p",
        { class: "note" },
        running ? "Acompanhando a entrega em tempo real." : "Disparo concluído.",
      ),
      h(
        "div",
        { class: "actions" },
        h(
          "button",
          {
            class: "primary",
            onclick: () =>
              void panel.ask(`Mostra o relatório completo da campanha ${accepted.name}.`),
          },
          "Relatório completo",
        ),
      ),
    ),
  );
  if (running && polls < MAX_POLLS) void pollLater(panel, accepted, polls + 1);
};

const pollLater = async (panel: Panel, accepted: Accepted, polls: number): Promise<void> => {
  await sleep(POLL_MS);
  const result = await panel.callTool<Progress>("campaign_report", { campaignId: accepted.id });
  if (result.ok) renderLive(panel, accepted, result.data, polls);
};

const onResult = (panel: Panel, result: ToolEnvelope<Result>): void => {
  if (!result.ok) {
    replace(panel.root, h("div", { class: "panel" }, errorBox(result.error.message)));
    return;
  }
  if ((result.data as Preview).preview === true) renderPreview(panel, result.data as Preview);
  else renderLive(panel, result.data as Accepted);
};

void bootPanel<Result>({
  name: "broadcast",
  onResult,
  onInput: (panel) => replace(panel.root, skeleton(5)),
});
