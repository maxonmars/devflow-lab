import { readFileSync } from "node:fs";
import { Agent, type ModelPort } from "../../core/index.ts";
import { renderSupportMessage } from "./message.ts";
import { sourcesSection } from "./sources.ts";
import { SUPPORT_SECTIONS, type SupportInput, type SupportResult, type SupportSection } from "./types.ts";

export type SupportOptions = Readonly<{ model: ModelPort; input: SupportInput }>;

/** Инструкция из prompts/*.md; текст промптов не хранится в TypeScript. */
function readPrompt(name: string): string {
  return readFileSync(new URL(`./prompts/${name}`, import.meta.url), "utf8").trim();
}

/** Разделы, для которых в ответе нет заголовка второго уровня с точным названием. */
export function missingSections(text: string): SupportSection[] {
  const headings = new Set([...text.matchAll(/^##[ \t]+(.+)$/gm)].map((match) => (match[1] ?? "").trim()));
  return (Object.keys(SUPPORT_SECTIONS) as SupportSection[]).filter((key) => !headings.has(SUPPORT_SECTIONS[key]));
}

/** Номера `[N]` раздела «Источники», которых нет среди рангов фрагментов; без раздела — пустой список. */
export function unknownSources(text: string, ranks: readonly number[]): number[] {
  const cited = sourcesSection(text.split("\n"))?.ranks ?? [];
  return cited.filter((rank) => !ranks.includes(rank));
}

/** Один вызов модели без инструментов; нарушения формата не повторяются, а возвращаются в результате. */
export async function answerSupport(options: SupportOptions): Promise<SupportResult> {
  const text = await new Agent(options.model, readPrompt("support.md")).respond(renderSupportMessage(options.input));
  return {
    text,
    missing: missingSections(text),
    unknownSources: unknownSources(
      text,
      options.input.docs.map((doc) => doc.rank),
    ),
  };
}
