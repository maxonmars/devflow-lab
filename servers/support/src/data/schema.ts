import { z } from "zod/v4";

/** Идентификатор клиента или тикета: буква или цифра, затем до 39 символов `A-Z a-z 0-9 _ -`. */
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

const id = z.string().regex(ID_PATTERN);

export const userSchema = z.object({
  id,
  name: z.string().min(1),
  email: z.string().min(1),
  plan: z.enum(["free", "pro", "business"]),
  accountStatus: z.enum(["active", "locked", "suspended"]),
  authMethod: z.enum(["password", "sso"]),
  twoFactor: z.boolean(),
});

const messageSchema = z.object({
  from: z.enum(["user", "support"]),
  at: z.iso.datetime(),
  text: z.string(),
});

export const ticketSchema = z.object({
  id,
  userId: id,
  subject: z.string().min(1),
  status: z.enum(["open", "pending", "closed"]),
  createdAt: z.iso.datetime(),
  messages: z.array(messageSchema),
});

export const supportDataSchema = z.object({ users: z.array(userSchema), tickets: z.array(ticketSchema) });

export type SupportData = z.output<typeof supportDataSchema>;
export type User = z.output<typeof userSchema>;
export type Ticket = z.output<typeof ticketSchema>;
export type TicketMessage = z.output<typeof messageSchema>;
