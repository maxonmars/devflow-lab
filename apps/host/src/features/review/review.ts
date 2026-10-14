import { readFileSync } from "node:fs";
import { Agent, type ModelPort } from "../../core/index.ts";
import { renderReviewMessage } from "./message.ts";
import { REVIEW_SECTIONS, type ReviewInput, type ReviewResult, type ReviewSection } from "./types.ts";

export type ReviewOptions = Readonly<{ model: ModelPort; systemPrompt: string; input: ReviewInput }>;

/** Инструкция из prompts/*.md; текст промптов не хранится в TypeScript. */
function readPrompt(name: string): string {
  return readFileSync(new URL(`./prompts/${name}`, import.meta.url), "utf8").trim();
}

/** Разделы, для которых в ответе нет заголовка второго уровня с точным названием. */
export function missingSections(text: string): ReviewSection[] {
  const headings = new Set([...text.matchAll(/^##[ \t]+(.+)$/gm)].map((match) => (match[1] ?? "").trim()));
  return (Object.keys(REVIEW_SECTIONS) as ReviewSection[]).filter((key) => !headings.has(REVIEW_SECTIONS[key]));
}

/** Один вызов модели без инструментов; ответ без раздела не повторяется, а отмечается в `missing`. */
export async function reviewChanges(options: ReviewOptions): Promise<ReviewResult> {
  const instruction = `${options.systemPrompt}\n\n${readPrompt("review.md")}`;
  const text = await new Agent(options.model, instruction).respond(renderReviewMessage(options.input));
  return { text, missing: missingSections(text) };
}
