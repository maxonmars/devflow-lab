import { Agent, type ModelPort } from "../../core/index.ts";
import { RagError } from "./errors.ts";
import { readPrompt } from "./prompts.ts";

/** Один вызов Agent без истории и инструментов; ответ должен быть одной строкой, иначе исходный вопрос не подставляется. */
export async function rewriteQuery(question: string, model: ModelPort): Promise<string> {
  const query = (await new Agent(model, readPrompt("rewrite.md")).respond(question)).trim();
  if (/[\r\n]/.test(query)) throw new RagError("REWRITE_INVALID", { reason: "multiline" });
  if (query.startsWith("```")) throw new RagError("REWRITE_INVALID", { reason: "fence" });
  return query;
}
