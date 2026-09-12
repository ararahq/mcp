import "./panel.css";
import type { ToolEnvelope } from "../model/envelope.js";
import { formatBrl } from "../model/format.js";
import {
  buildTimeline,
  humanizeMessageStatus,
  isFailedStatus,
  isTerminalStatus,
} from "../model/status.js";
import { bootPanel, errorBox, h, replace, skeleton, sleep, type Panel } from "./shared.js";

const POLL_MS = 3000;
const MAX_POLLS = 40;

type MessageStatus = {
  id: string;
  status: string;
  receiver: string;
  cost?: number | null;
  reason?: string | null;
  body?: string | null;
};
type Window = {
  recipient: { phone: string; name?: string };
  isWindowOpen: boolean;
  hoursRemaining?: number | null;
};
type Template = { status: string; rejectionReason?: string | null; category?: string | null };
type Result = MessageStatus | Window | Template;

const isMessage = (data: Result): data is MessageStatus =>
  typeof (data as MessageStatus).receiver === "string";
const isWindow = (data: Result): data is Window =>
  typeof (data as Window).isWindowOpen === "boolean";

const head = (eyebrow: string, title: string, pill: HTMLElement, sub?: string): HTMLElement =>
  h(
    "div",
    { class: "head" },
    h(
      "div",
      {},
      h("p", { class: "eyebrow" }, eyebrow),
      h("h1", { class: "title" }, title),
      sub ? h("p", { class: "sub" }, sub) : null,
    ),
    pill,
  );

const timeline = (status: string): HTMLElement =>
  h(
    "div",
    { class: "timeline" },
    ...buildTimeline(status).map((step) =>
      h(
        "div",
        { class: `step ${step.state}` },
        h(
          "div",
          { class: "ring" },
          step.state === "done" ? "✓" : step.state === "failed" ? "!" : "",
        ),
        step.label,
      ),
    ),
  );

const renderMessage = (panel: Panel, message: MessageStatus, polls = 0): void => {
  const failed = isFailedStatus(message.status);
  const terminal = isTerminalStatus(message.status);
  const pill = h(
    "span",
    { class: `pill ${failed ? "bad" : terminal ? "ok" : "live"}` },
    h("i", { class: `dot ${terminal ? "" : "pulse"}` }),
    humanizeMessageStatus(message.status),
  );
  replace(
    panel.root,
    h(
      "div",
      { class: "panel" },
      head("mensagem", message.receiver, pill, `${message.id} · ${formatBrl(message.cost ?? 0)}`),
      timeline(message.status),
      typeof message.body === "string" && message.body.length > 0
        ? h("div", { class: "bubble", style: "margin-top:10px" }, message.body)
        : null,
      failed && typeof message.reason === "string"
        ? h("div", { class: "error", style: "margin-top:10px" }, message.reason)
        : null,
      h("p", { class: "note" }, terminal ? "Status final." : "Acompanhando a entrega."),
      h(
        "div",
        { class: "actions" },
        failed
          ? h(
              "button",
              {
                class: "primary",
                onclick: () =>
                  void panel.ask(
                    `A mensagem ${message.id} falhou: ${message.reason ?? ""}. O que eu faço?`,
                  ),
              },
              "Resolver",
            )
          : h(
              "button",
              { onclick: () => void panel.ask(`Lê a conversa com ${message.receiver}.`) },
              "Ver conversa",
            ),
      ),
    ),
  );
  if (!terminal && polls < MAX_POLLS) void pollLater(panel, message.id, polls + 1);
};

const pollLater = async (panel: Panel, messageId: string, polls: number): Promise<void> => {
  await sleep(POLL_MS);
  const result = await panel.callTool<MessageStatus>("check_status", { messageId });
  if (result.ok) renderMessage(panel, result.data, polls);
};

const renderWindow = (panel: Panel, data: Window): void => {
  const who = data.recipient.name ?? data.recipient.phone;
  const hours =
    typeof data.hoursRemaining === "number" ? `${data.hoursRemaining.toFixed(1)}h restantes` : "";
  replace(
    panel.root,
    h(
      "div",
      { class: "panel" },
      head(
        "janela de 24h",
        who,
        h(
          "span",
          { class: `pill ${data.isWindowOpen ? "ok" : "warn"}` },
          data.isWindowOpen ? "aberta" : "fechada",
        ),
        data.recipient.phone,
      ),
      h(
        "p",
        { class: "sub" },
        data.isWindowOpen
          ? `Pode mandar texto livre. ${hours}`
          : "Fora da janela só entra template aprovado. Escolha um ou crie um novo.",
      ),
      h(
        "div",
        { class: "actions" },
        data.isWindowOpen
          ? h(
              "button",
              {
                class: "primary",
                onclick: () =>
                  void panel.ask(`Escreve uma mensagem pra ${who} e me mostra antes de enviar.`),
              },
              "Escrever mensagem",
            )
          : h(
              "button",
              {
                class: "primary",
                onclick: () =>
                  void panel.ask(
                    `Lista meus templates aprovados e sugere um pra falar com ${who}.`,
                  ),
              },
              "Escolher template",
            ),
      ),
    ),
  );
};

const renderTemplate = (panel: Panel, data: Template): void => {
  const approved = data.status.toUpperCase() === "APPROVED";
  const rejected = data.status.toUpperCase() === "REJECTED";
  replace(
    panel.root,
    h(
      "div",
      { class: "panel" },
      head(
        "template",
        approved ? "Aprovado pela Meta" : rejected ? "Reprovado pela Meta" : "Em análise",
        h(
          "span",
          { class: `pill ${approved ? "ok" : rejected ? "bad" : "live"}` },
          h("i", { class: `dot ${approved || rejected ? "" : "pulse"}` }),
          data.status,
        ),
        data.category ?? undefined,
      ),
      rejected && typeof data.rejectionReason === "string"
        ? h("div", { class: "error" }, data.rejectionReason)
        : null,
      h(
        "div",
        { class: "actions" },
        approved
          ? h(
              "button",
              {
                class: "primary",
                onclick: () => void panel.ask("Monta um disparo com esse template."),
              },
              "Disparar com ele",
            )
          : rejected
            ? h(
                "button",
                {
                  class: "primary",
                  onclick: () =>
                    void panel.ask(
                      `O template foi reprovado: ${data.rejectionReason ?? ""}. Reescreve e submete de novo.`,
                    ),
                },
                "Corrigir e reenviar",
              )
            : null,
      ),
    ),
  );
};

const onResult = (panel: Panel, result: ToolEnvelope<Result>): void => {
  if (!result.ok) {
    replace(panel.root, h("div", { class: "panel" }, errorBox(result.error.message)));
    return;
  }
  if (isMessage(result.data)) renderMessage(panel, result.data);
  else if (isWindow(result.data)) renderWindow(panel, result.data);
  else renderTemplate(panel, result.data);
};

void bootPanel<Result>({
  name: "status",
  onResult,
  onInput: (panel) => replace(panel.root, skeleton(3)),
});
