import { answerWithRag, renderCitedAnswer } from "../features/rag/index.ts";
import { type McpServers, systemPrompt } from "./ask.ts";
import { fragmentLines, prepareRag, type RagAnswerHandlerOptions, type RagReply } from "./ragAnswer.ts";
import { combineToolSources, type WithToolSource, withSessions } from "./toolSources.ts";

/** Лимит вызовов инструментов за ответ `info`: до четырёх вызовов за ответ. */
export const INFO_MAX_TOOL_CALLS = 4;

export type ProjectInfoOptions = RagAnswerHandlerOptions &
  Readonly<{ servers: McpServers; withToolSource: WithToolSource }>;

/** `info <вопрос>`: настройки, модель и индекс проверяются до запуска MCP-серверов. */
export function createProjectInfoHandler(options: ProjectInfoOptions): (text: string) => Promise<RagReply> {
  return async (text) => {
    const { values, model, index, retrieval, answerPrompt } = await prepareRag(options);
    const config = options.getConfig();
    return withSessions(options.servers(config), options.withToolSource, options.view, async (sources) => {
      const result = await answerWithRag({
        question: text,
        index,
        model,
        systemPrompt: systemPrompt(),
        answerPrompt,
        mode: values["rag.retrievalMode"],
        ...retrieval,
        tools: { source: combineToolSources(sources), maxToolCalls: INFO_MAX_TOOL_CALLS },
      });
      return { answer: renderCitedAnswer(result.answer), fragments: fragmentLines(result.hits) };
    });
  };
}
