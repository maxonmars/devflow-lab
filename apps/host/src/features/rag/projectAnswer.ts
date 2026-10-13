import { Agent, type ModelPort, type ToolSource } from "../../core/index.ts";
import { type CitedAnswer, parseCitedAnswer } from "./citations.ts";
import { renderRagMessage } from "./context.ts";
import { readPrompt } from "./prompts.ts";
import type { SearchHit } from "./search.ts";

/** Инструменты проекта для ответа: источник и лимит вызовов за один ответ. */
export type ProjectTools = Readonly<{ source: ToolSource; maxToolCalls: number }>;

export type ProjectAnswerOptions = Readonly<{
  model: ModelPort;
  systemPrompt: string;
  question: string;
  hits: readonly SearchHit[];
  tools: ProjectTools;
}>;

/**
 * Ответ по фрагментам и инструментам проекта: модель вызывается и при пустом отборе — ответ может дать инструмент.
 * Имена вызванных инструментов сверяются с разделом «Данные проекта».
 */
export async function generateWithTools(
  options: ProjectAnswerOptions,
): Promise<Readonly<{ answer: CitedAnswer; contextChars: number }>> {
  const { source, maxToolCalls } = options.tools;
  const called: string[] = [];
  const recorded: ToolSource = {
    listTools: () => source.listTools(),
    callTool: (invocation) => {
      called.push(invocation.name);
      return source.callTool(invocation);
    },
  };
  const message = renderRagMessage(options.question, options.hits);
  const instruction = `${options.systemPrompt}\n\n${readPrompt("project.md")}`;
  const raw = await new Agent(options.model, instruction, { maxToolCalls }).respond(message, { tools: recorded });
  return { answer: parseCitedAnswer(raw, options.hits, called), contextChars: [...message].length };
}
