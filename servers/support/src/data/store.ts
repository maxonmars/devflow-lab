import { SupportDataError } from "./errors.ts";
import { type SupportData, supportDataSchema, type Ticket, type User } from "./schema.ts";

/** Предел размера файла данных в UTF-16 символах `string.length`. */
export const MAX_DATA_CHARS = 1_000_000;

/** Читает файл данных целиком; в main.ts — `readFile` пути из `--data`, в тестах — подмена. */
export type ReadData = () => Promise<string>;

export type TicketRecord = Readonly<{ ticket: Ticket; user: User }>;

/** Файл читается на каждый вызов: сервер живёт одну команду host, а правка JSON видна сразу. */
export async function loadSupportData(read: ReadData): Promise<SupportData> {
  let text: string;
  try {
    text = await read();
  } catch {
    throw new SupportDataError("DATA_UNREADABLE");
  }
  if (text.length > MAX_DATA_CHARS) throw new SupportDataError("DATA_TOO_LARGE");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SupportDataError("DATA_INVALID");
  }
  const parsed = supportDataSchema.safeParse(raw);
  if (!parsed.success) throw new SupportDataError("DATA_INVALID");
  return parsed.data;
}

export function findTicket(data: SupportData, id: string): TicketRecord {
  const ticket = data.tickets.find((item) => item.id === id);
  if (!ticket) throw new SupportDataError("TICKET_NOT_FOUND");
  const user = data.users.find((item) => item.id === ticket.userId);
  if (!user) throw new SupportDataError("USER_NOT_FOUND");
  return { ticket, user };
}
