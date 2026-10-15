import { InputError } from "../adapters/cli/index.ts";
import type { ToolSource } from "../core/index.ts";
import type { StdioToolSourceOptions } from "../features/mcp/index.ts";
import { type SearchHit, searchQueries } from "../features/rag/index.ts";
import { answerSupport, renderSupport, type SupportDoc } from "../features/support/index.ts";
import type { ResolvedConfig } from "./config.ts";
import { prepareRag, type RagAnswerHandlerOptions } from "./ragAnswer.ts";
import { callText, combineToolSources, type WithToolSource, withSessions } from "./toolSources.ts";

/** Имя инструмента сервера поддержки; host не импортирует сервер, поэтому оно повторено здесь. */
export const SUPPORT_TICKET_TOOL = "get_ticket";
/** Сколько кодовых точек текста тикета входит во второй запрос к RAG. */
export const SUPPORT_QUERY_CHARS = 1500;

export type SupportHandlerOptions = RagAnswerHandlerOptions &
  Readonly<{ server: (config: ResolvedConfig) => StdioToolSourceOptions; withToolSource: WithToolSource }>;

const toDoc = ({ rank, chunk }: SearchHit): SupportDoc => ({
  rank,
  file: chunk.file,
  title: chunk.title,
  sections: chunk.sections,
  text: chunk.text,
});

async function requireTicketTool(source: ToolSource): Promise<void> {
  if (!(await source.listTools()).some((tool) => tool.name === SUPPORT_TICKET_TOOL)) {
    throw new InputError(`MCP-сервер поддержки не объявил инструмент ${SUPPORT_TICKET_TOOL}.`);
  }
}

/** `support <тикет> <вопрос...>`: модель и индекс проверяются до запуска сервера; модель вызывается один раз. */
export function createSupportHandler(
  options: SupportHandlerOptions,
): (ticketId: string, question: string) => Promise<string> {
  return async (ticketId, question) => {
    const { model, modelName, index, retrieval } = await prepareRag(options);
    const config = options.getConfig();
    return withSessions([options.server(config)], options.withToolSource, options.view, async (sources) => {
      const source = combineToolSources(sources);
      await requireTicketTool(source);
      const ticket = await callText(source, SUPPORT_TICKET_TOOL, { id: ticketId });
      const queries = [question, [...ticket].slice(0, SUPPORT_QUERY_CHARS).join("")];
      const docs = (await searchQueries({ index, queries, ...retrieval })).map(toDoc);
      const input = { ticketId, ticket, question, docs };
      return renderSupport(await answerSupport({ model, input }), input, modelName);
    });
  };
}
