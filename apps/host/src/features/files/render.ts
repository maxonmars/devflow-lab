import { createTwoFilesPatch } from "diff";
import type { FileChange } from "./types.ts";

/** Забор длиннее любой серии обратных кавычек в patch: `.md` сам содержит блоки кода. */
function fence(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  return "`".repeat(longest + 1);
}

function patchBlock(change: FileChange): string {
  const patch = createTwoFilesPatch(`a/${change.path}`, `b/${change.path}`, change.before, change.after)
    .replace(/^=+\n/, "")
    .trimEnd();
  const mark = fence(patch);
  return `### ${change.path}\n\n${mark}diff\n${patch}\n${mark}`;
}

/** Ответ модели как есть; при правках к нему добавляется раздел с unified diff по каждому файлу. */
export function renderFilesResult(answer: string, changes: readonly FileChange[]): string {
  if (changes.length === 0) return answer;
  return `${answer.trimEnd()}\n\n## Предложенные изменения\n\n${changes.map(patchBlock).join("\n\n")}`;
}
