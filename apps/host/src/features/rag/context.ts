import { fence } from "./format.ts";
import type { SearchHit } from "./search.ts";

function fragment(hit: SearchHit): string {
  const { chunk } = hit;
  const mark = fence(chunk.text);
  return [
    `### Фрагмент ${hit.rank}`,
    "",
    `- Файл: \`${chunk.file}\``,
    `- Документ: ${chunk.title}`,
    `- Разделы: ${chunk.sections.join("; ")}`,
    "",
    `${mark}markdown`,
    chunk.text,
    mark,
  ].join("\n");
}

/** Сообщение пользователя в режиме RAG: найденные фрагменты, затем вопрос; инструкции модели здесь нет. */
export function renderRagMessage(question: string, hits: readonly SearchHit[]): string {
  return ["## Фрагменты документации", ...hits.map(fragment), `## Вопрос\n\n${question}`].join("\n\n");
}
