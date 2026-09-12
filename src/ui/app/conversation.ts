import "./panel.css";
import type { ToolEnvelope } from "../model/envelope.js";
import { formatTime } from "../model/format.js";
import { bootPanel, errorBox, h, replace, skeleton, type Panel } from "./shared.js";

type Message = {
  direction: string;
  status: string;
  body?: string | null;
  templateName?: string | null;
  createdAt: string;
};
type Conversation = {
  phone: string;
  total: number;
  messages: Message[];
  recipient: { phone: string; name?: string };
};
type Sent = { id: string; status: string };

const bubble = (message: Message): HTMLElement => {
  const inbound = message.direction.toUpperCase() === "INBOUND";
  const text =
    typeof message.body === "string" && message.body.length > 0
      ? message.body
      : `[template ${message.templateName ?? "?"}]`;
  return h(
    "div",
    { class: `msg ${inbound ? "in" : "out"}` },
    inbound ? null : h("span", { class: "tag" }, "você"),
    text,
    h("span", { class: "t" }, formatTime(message.createdAt)),
  );
};

const render = (
  panel: Panel,
  conversation: Conversation,
  extra: Message[] = [],
  notice?: HTMLElement,
): void => {
  const who = conversation.recipient.name ?? conversation.recipient.phone;
  const ordered = [...conversation.messages].reverse().concat(extra);
  const inbound = ordered.filter((message) => message.direction.toUpperCase() === "INBOUND").length;
  const input = h("input", {
    placeholder: `Responder ${who}…`,
    "aria-label": "Resposta",
  }) as HTMLInputElement;
  const send = h(
    "button",
    {
      class: "primary",
      onclick: () => {
        const text = input.value.trim();
        if (text.length === 0) return;
        send.setAttribute("disabled", "");
        void reply(panel, conversation, extra, text);
      },
    },
    "Enviar",
  );
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") send.click();
  });
  const thread = h("div", { class: "thread" }, ...ordered.map(bubble));
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
          h("p", { class: "eyebrow" }, "conversa"),
          h("h1", { class: "title" }, who),
          h(
            "p",
            { class: "sub" },
            `${conversation.recipient.phone} · ${conversation.total} mensagens · ${inbound} da pessoa`,
          ),
        ),
        h(
          "span",
          { class: `pill ${inbound > 0 ? "ok" : ""}` },
          inbound > 0 ? "respondeu" : "sem resposta",
        ),
      ),
      thread,
      notice ?? null,
      h("div", { class: "compose" }, input, send),
      h(
        "div",
        { class: "actions" },
        h(
          "button",
          {
            onclick: () =>
              void panel.ask(`Rascunha uma resposta pra ${who} com base nessa conversa.`),
          },
          "Sugerir resposta",
        ),
        h(
          "button",
          {
            onclick: () =>
              void panel.ask(
                `${who} pediu pra sair? Registra o opt-out de ${conversation.recipient.phone}.`,
              ),
          },
          "Pediu pra sair",
        ),
      ),
    ),
  );
  thread.scrollTop = thread.scrollHeight;
};

const reply = async (
  panel: Panel,
  conversation: Conversation,
  extra: Message[],
  text: string,
): Promise<void> => {
  const result = await panel.callTool<Sent>("send_whatsapp", {
    to: conversation.recipient.phone,
    message: text,
  });
  if (!result.ok) {
    render(panel, conversation, extra, errorBox(result.error.message));
    return;
  }
  const sent: Message = {
    direction: "OUTBOUND",
    status: result.data.status,
    body: text,
    createdAt: new Date().toISOString(),
  };
  render(panel, conversation, [...extra, sent]);
};

const onResult = (panel: Panel, result: ToolEnvelope<Conversation>): void => {
  if (!result.ok) {
    replace(panel.root, h("div", { class: "panel" }, errorBox(result.error.message)));
    return;
  }
  render(panel, result.data);
};

void bootPanel<Conversation>({
  name: "conversation",
  onResult,
  onInput: (panel) => replace(panel.root, skeleton(5)),
});
