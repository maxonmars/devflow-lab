import { readFileSync } from "node:fs";

/** Инструкция из prompts/files.md; `app/system.md` запрещает обещать правки файлов и здесь не используется. */
export function filesSystemPrompt(): string {
  return readFileSync(new URL("./prompts/files.md", import.meta.url), "utf8").trim();
}
