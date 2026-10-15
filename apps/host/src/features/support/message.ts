import type { SupportDoc, SupportInput } from "./types.ts";

/** Забор длиннее любой серии обратных кавычек в тексте; копия хелпера rag — фичи не импортируют друг друга. */
function fence(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  return "`".repeat(longest + 1);
}

function fragment(doc: SupportDoc): string {
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

/** Сообщение пользователя: документация, тикет, вопрос клиента; инструкции модели здесь нет. */
export function renderSupportMessage(input: SupportInput): string {
  const docs = input.docs.length > 0 ? input.docs.map(fragment) : ["Подходящих фрагментов нет."];
  const mark = fence(input.ticket);
  return [
    "## Документация продукта",
    ...docs,
    `## Тикет ${input.ticketId}`,
    `${mark}text\n${input.ticket}\n${mark}`,
    "## Вопрос клиента",
    input.question,
  ].join("\n\n");
}
