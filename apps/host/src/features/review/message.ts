import type { ReviewDoc, ReviewFile, ReviewInput } from "./types.ts";

/** Забор длиннее любой серии обратных кавычек в тексте; копия хелпера rag — фичи не импортируют друг друга. */
function fence(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  return "`".repeat(longest + 1);
}

function fragment(doc: ReviewDoc): string {
  const mark = fence(doc.text);
  return [
    `### Фрагмент ${doc.rank}`,
    "",
    `- Файл: \`${doc.file}\``,
    `- Документ: ${doc.title}`,
    `- Разделы: ${doc.sections.join("; ")}`,
    "",
    `${mark}markdown`,
    doc.text,
    mark,
  ].join("\n");
}

function change(file: ReviewFile): string {
  const from = file.from === undefined ? "" : ` (из ${file.from})`;
  const mark = fence(file.diff);
  const parts = [`### ${file.status} ${file.path}${from}`, `${mark}diff\n${file.diff}\n${mark}`];
  return [...parts, ...(file.content === undefined ? [] : [file.content])].join("\n\n");
}

/** Сообщение пользователя для ревью: документация, изменения по файлам, пропущенное; инструкции модели здесь нет. */
export function renderReviewMessage(input: ReviewInput): string {
  const docs = input.docs.length > 0 ? input.docs.map(fragment) : ["Подходящих фрагментов нет."];
  const omitted =
    input.omitted.length > 0
      ? [`## Не вошло в контекст\n\n${input.omitted.map((path) => `- ${path}`).join("\n")}`]
      : [];
  return [
    "## Документация проекта",
    ...docs,
    `## Изменения относительно ${input.base}`,
    ...input.files.map(change),
    ...omitted,
  ].join("\n\n");
}
