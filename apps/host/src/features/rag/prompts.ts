import { readFileSync } from "node:fs";

/** Инструкция из prompts/*.md; текст промптов не хранится в TypeScript. */
export function readPrompt(name: string): string {
  return readFileSync(new URL(`./prompts/${name}`, import.meta.url), "utf8").trim();
}
