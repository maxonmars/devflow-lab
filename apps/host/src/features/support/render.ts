import { sourcesSection } from "./sources.ts";
import { SUPPORT_SECTIONS, type SupportDoc, type SupportInput, type SupportResult } from "./types.ts";

const docLabel = (doc: SupportDoc): string => `${doc.file} › ${doc.sections[0] ?? doc.title}`;

function contextLines(input: SupportInput, modelLabel: string): string[] {
  const docs = input.docs.map((doc) => `  ${doc.rank}. ${docLabel(doc)}`);
  return [
    `- Тикет: \`${input.ticketId}\``,
    `- Вопрос: ${input.question}`,
    docs.length > 0 ? `- Фрагменты документации:\n${docs.join("\n")}` : "- Фрагменты документации: нет",
    `- Модель: ${modelLabel}`,
  ];
}

/** Заменяет строки `- [N]` раздела «Источники» на `- [N] файл › раздел`; раздел без номеров не трогает. */
function describeSources(body: string, docs: readonly SupportDoc[]): string {
  const lines = body.split("\n");
  const section = sourcesSection(lines);
  if (section === undefined || section.ranks.length === 0) return body;
  const described = section.ranks.map((rank) => {
    const doc = docs.find((candidate) => candidate.rank === rank);
    return `- [${rank}] ${doc === undefined ? "фрагмента не было в контексте" : docLabel(doc)}`;
  });
  const tail = section.to < lines.length ? ["", ...lines.slice(section.to)] : [];
  return [...lines.slice(0, section.from), "", ...described, ...tail].join("\n");
}

/** Итоговый Markdown для CLI; разделы модели понижены до `###`, чтобы читаться одним блоком. */
export function renderSupport(result: SupportResult, input: SupportInput, modelLabel: string): string {
  const body = describeSources(result.text.trim(), input.docs).replace(/^##(?=[ \t])/gm, "###");
  const missing =
    result.missing.length > 0
      ? [`Ответ модели без разделов: ${result.missing.map((key) => SUPPORT_SECTIONS[key]).join(", ")}.`]
      : [];
  const unknown =
    result.unknownSources.length > 0
      ? [`Источники вне контекста: ${result.unknownSources.map((rank) => `[${rank}]`).join(", ")}.`]
      : [];
  return [
    `## Ответ поддержки по тикету ${input.ticketId}`,
    body,
    ...missing,
    ...unknown,
    `### Контекст ответа\n\n${contextLines(input, modelLabel).join("\n")}`,
  ].join("\n\n");
}
