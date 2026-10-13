import { readFileSync } from "node:fs";
import { Agent, type ModelPort } from "../core/index.ts";
import type { ResolvedConfig } from "./config.ts";
import { type CreateModel, createConfiguredModel } from "./model.ts";

export type AskHandlerOptions = Readonly<{ createModel: CreateModel; getConfig: () => ResolvedConfig }>;

export function systemPrompt(): string {
  return readFileSync(new URL("./system.md", import.meta.url), "utf8").trim();
}

/** Ответ без поиска по документам; режим RAG получает ту же системную инструкцию плюс prompts/answer.md. */
export function answerPlain(model: ModelPort, text: string): Promise<string> {
  return new Agent(model, systemPrompt()).respond(text);
}

/** Реплика без поиска и без истории; в режиме RAG команду `ask` обслуживает ragChat.ts. */
export function createAskHandler(options: AskHandlerOptions): (text: string) => Promise<string> {
  return (text) => answerPlain(createConfiguredModel(options.getConfig(), options.createModel), text);
}
