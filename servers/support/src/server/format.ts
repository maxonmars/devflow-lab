import type { Ticket, TicketMessage, User } from "../data/schema.ts";
import type { TicketRecord } from "../data/store.ts";

/** Сколько последних сообщений переписки попадает в результат `get_ticket`. */
export const MAX_TICKET_MESSAGES = 50;

export type TicketView = Readonly<{ ticket: Ticket; user: User; messagesShown: number; messagesTotal: number }>;

const TICKET_STATUS = { open: "открыт", pending: "ожидает ответа клиента", closed: "закрыт" } as const;
const PLAN = { free: "Free", pro: "Pro", business: "Business" } as const;
const ACCOUNT_STATUS = { active: "активен", locked: "временно заблокирован", suspended: "приостановлен" } as const;
const AUTH_METHOD = { password: "email и пароль", sso: "SSO" } as const;
const AUTHOR = { user: "клиент", support: "поддержка" } as const;

/** Переписка по времени; при обрезке остаются последние сообщения. */
export function ticketView({ ticket, user }: TicketRecord): TicketView {
  const ordered = [...ticket.messages].sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  const messages = ordered.slice(-MAX_TICKET_MESSAGES);
  return {
    ticket: { ...ticket, messages },
    user,
    messagesShown: messages.length,
    messagesTotal: ticket.messages.length,
  };
}

function messageLine(message: TicketMessage): string {
  return `- ${message.at}, ${AUTHOR[message.from]}: ${message.text.replaceAll("\n", "\n  ")}`;
}

/** Текст для модели; host передаёт его целиком и не разбирает, поэтому формат — не контракт. */
export function ticketText({ ticket, user, messagesShown, messagesTotal }: TicketView): string {
  const cut = messagesShown < messagesTotal ? [`Показано ${messagesShown} из ${messagesTotal}.`] : [];
  const conversation = messagesTotal > 0 ? ticket.messages.map(messageLine) : ["Сообщений нет."];
  return [
    `Тикет ${ticket.id}: ${ticket.subject}`,
    `Статус тикета: ${TICKET_STATUS[ticket.status]} (${ticket.status})`,
    `Создан: ${ticket.createdAt}`,
    "",
    "Клиент:",
    `- Имя: ${user.name}`,
    `- Email: ${user.email}`,
    `- Тариф: ${PLAN[user.plan]}`,
    `- Статус аккаунта: ${ACCOUNT_STATUS[user.accountStatus]} (${user.accountStatus})`,
    `- Способ входа: ${AUTH_METHOD[user.authMethod]} (${user.authMethod})`,
    `- Двухфакторная аутентификация: ${user.twoFactor ? "включена" : "выключена"}`,
    "",
    `Переписка (${messagesTotal}):`,
    ...conversation,
    ...cut,
  ].join("\n");
}
