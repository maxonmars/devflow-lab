import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { describeSupportError } from "../data/errors.ts";
import { ID_PATTERN, ticketSchema, userSchema } from "../data/schema.ts";
import { findTicket, loadSupportData, type ReadData } from "../data/store.ts";
import { ticketText, ticketView } from "./format.ts";

export const SUPPORT_TOOL_NAMES = { ticket: "get_ticket" } as const;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const ticketOutput = z.object({
  ticket: ticketSchema,
  user: userSchema,
  messagesShown: z.number(),
  messagesTotal: z.number(),
});

type Reply = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: true };

/** Ошибка данных становится результатом с `isError`: вызывающий видит причину, MCP-вызов не обрывается. */
async function reply<T extends Record<string, unknown>>(read: () => Promise<T>, text: (value: T) => string) {
  try {
    const value = await read();
    return { content: [{ type: "text" as const, text: text(value) }], structuredContent: value } satisfies Reply;
  } catch (error) {
    return {
      isError: true as const,
      content: [{ type: "text" as const, text: describeSupportError(error) }],
    } satisfies Reply;
  }
}

export function registerSupportTools(server: McpServer, readData: ReadData): void {
  server.registerTool(
    SUPPORT_TOOL_NAMES.ticket,
    {
      description:
        "Тикет поддержки по идентификатору: тема, статус, дата создания, данные клиента (тариф, статус аккаунта, " +
        "способ входа, двухфакторная аутентификация) и переписка по времени.",
      inputSchema: z.object({
        id: z
          .string()
          .regex(ID_PATTERN, "Недопустимый идентификатор тикета.")
          .describe("Идентификатор тикета, например T-1001."),
      }),
      outputSchema: ticketOutput,
      annotations: READ_ONLY,
    },
    ({ id }) => reply(async () => ticketView(findTicket(await loadSupportData(readData), id)), ticketText),
  );
}
