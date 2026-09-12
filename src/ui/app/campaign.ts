import "./panel.css";
import {
  buildFunnel,
  humanizeCampaignStatus,
  isCampaignRunning,
  progressPercent,
  type CampaignCounts,
} from "../model/campaign.js";
import type { ToolEnvelope } from "../model/envelope.js";
import { formatBrl, formatDate } from "../model/format.js";
import { bootPanel, countUp, errorBox, h, replace, skeleton, sleep, type Panel } from "./shared.js";

const POLL_MS = 5000;
const MAX_POLLS = 60;

type Campaign = CampaignCounts & {
  id: string;
  name: string;
  status: string;
  templateName: string;
  totalCost: number;
  createdAt?: string | null;
  convertedValue?: number;
  blockedCount?: number;
  blockReasons?: Array<{ motivo: string; quantidade: number }>;
  refundCount?: number;
  refundValue?: number;
};
type CampaignList = { data: Campaign[] };
type Result = Campaign | CampaignList;

const isList = (data: Result): data is CampaignList => Array.isArray((data as CampaignList).data);

const statusPill = (status: string): HTMLElement => {
  const running = isCampaignRunning(status);
  const tone = running ? "live" : /CANCEL|FAIL/i.test(status) ? "bad" : "ok";
  return h(
    "span",
    { class: `pill ${tone}` },
    h("i", { class: `dot ${running ? "pulse" : ""}` }),
    humanizeCampaignStatus(status),
  );
};

const metric = (label: string, value: number, format?: (n: number) => string, accent = false) => {
  const number = h("p", { class: `v ${accent ? "accent" : ""}` }, "0");
  countUp(number, value, format);
  return h("div", { class: "metric" }, h("p", { class: "k" }, label), number);
};

const funnel = (campaign: Campaign): HTMLElement => {
  const rows = buildFunnel(campaign).map((step, index) => {
    const fill = h("i", { class: index > 2 ? "" : "soft" });
    requestAnimationFrame(() => {
      fill.style.width = `${step.percent}%`;
    });
    return h(
      "div",
      { class: "row" },
      h("span", { class: "lbl" }, step.label),
      h("div", { class: "bar" }, fill),
      h("span", { class: "num" }, h("b", {}, String(step.count)), ` · ${step.percent}%`),
    );
  });
  return h("div", { class: "funnel" }, ...rows);
};

const reasons = (campaign: Campaign): HTMLElement | null => {
  const items = campaign.blockReasons ?? [];
  if (items.length === 0) return null;
  return h(
    "div",
    { class: "reasons" },
    ...items.map((item) => h("span", { class: "pill warn" }, `${item.quantidade} ${item.motivo}`)),
  );
};

const renderDetail = (panel: Panel, campaign: Campaign, polls = 0): void => {
  const running = isCampaignRunning(campaign.status);
  const refund =
    (campaign.refundValue ?? 0) > 0 ? ` · estornado ${formatBrl(campaign.refundValue ?? 0)}` : "";
  const view = h(
    "div",
    { class: "panel" },
    h(
      "div",
      { class: "head" },
      h(
        "div",
        {},
        h("p", { class: "eyebrow" }, "campanha"),
        h("h1", { class: "title" }, campaign.name),
        h("p", { class: "sub" }, `${campaign.templateName} · ${formatDate(campaign.createdAt)}`),
      ),
      statusPill(campaign.status),
    ),
    h(
      "div",
      { class: "metrics" },
      metric("Base", campaign.totalMessages),
      metric("Responderam", campaign.replyCount ?? 0, undefined, true),
      metric("Receita", campaign.convertedValue ?? 0, formatBrl, true),
      metric("Custo", campaign.totalCost, formatBrl),
    ),
    funnel(campaign),
    reasons(campaign),
    h(
      "p",
      { class: "note" },
      running
        ? `Disparando: ${progressPercent(campaign)}% da base já saiu. Atualiza sozinho.`
        : `Concluída${refund}.`,
    ),
    h(
      "div",
      { class: "actions" },
      h(
        "button",
        {
          class: "primary",
          onclick: () =>
            void panel.ask(
              `Quem respondeu à campanha ${campaign.name}? Lê as conversas e me sugere respostas.`,
            ),
        },
        "Ver quem respondeu",
      ),
      h(
        "button",
        {
          onclick: () =>
            void panel.ask(
              `Monta um reenvio da campanha ${campaign.name} só pra quem não leu, com outro template.`,
            ),
        },
        "Reenviar aos não lidos",
      ),
      h("button", { onclick: () => void refresh(panel, campaign.id) }, "Atualizar"),
    ),
  );
  replace(panel.root, view);
  if (running && polls < MAX_POLLS) void pollLater(panel, campaign.id, polls + 1);
};

const refresh = async (panel: Panel, campaignId: string, polls = 0): Promise<void> => {
  const result = await panel.callTool<Campaign>("campaign_report", { campaignId });
  if (result.ok) renderDetail(panel, result.data, polls);
  else replace(panel.root, h("div", { class: "panel" }, errorBox(result.error.message)));
};

const pollLater = async (panel: Panel, campaignId: string, polls: number): Promise<void> => {
  await sleep(POLL_MS);
  await refresh(panel, campaignId, polls);
};

const renderList = (panel: Panel, list: CampaignList): void => {
  const cards = list.data.map((campaign) => {
    const fill = h("i", {});
    requestAnimationFrame(() => {
      fill.style.width = `${progressPercent(campaign)}%`;
    });
    return h(
      "div",
      { class: "card", onclick: () => void refresh(panel, campaign.id) },
      h("span", { class: "name" }, campaign.name),
      statusPill(campaign.status),
      h(
        "span",
        { class: "meta" },
        `${campaign.templateName} · ${campaign.deliveredCount}/${campaign.totalMessages} entregues · ${campaign.readCount} lidas · ${formatBrl(campaign.totalCost)}`,
      ),
      h("span", { class: "meta" }, formatDate(campaign.createdAt)),
      h("div", { class: "mini" }, fill),
    );
  });
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
          h("p", { class: "eyebrow" }, "campanhas"),
          h("h1", { class: "title" }, "O que voltou"),
        ),
      ),
      cards.length === 0
        ? h("p", { class: "sub" }, "Nenhuma campanha ainda.")
        : h("div", { class: "list" }, ...cards),
    ),
  );
};

const onResult = (panel: Panel, result: ToolEnvelope<Result>): void => {
  if (!result.ok) {
    replace(panel.root, h("div", { class: "panel" }, errorBox(result.error.message)));
    return;
  }
  if (isList(result.data)) renderList(panel, result.data);
  else renderDetail(panel, result.data);
};

void bootPanel<Result>({
  name: "campaign",
  onResult,
  onInput: (panel) => replace(panel.root, skeleton()),
});
