import { fence } from "../rag/format.ts";
import { REVIEW_SECTIONS, type ReviewInput, type ReviewResult } from "./types.ts";

function contextLines(input: ReviewInput, modelLabel: string): string[] {
  const docs = input.docs.map((doc) => `  ${doc.rank}. ${doc.file} › ${doc.sections[0] ?? doc.title}`);
  return [
    `- База: \`${input.base}\``,
    `- Файлов в контексте: ${input.files.length}`,
    ...(input.omitted.length > 0
      ? [`- Не вошло в контекст: ${input.omitted.map((path) => `\`${path}\``).join(", ")}`]
      : []),
    docs.length > 0 ? `- Фрагменты документации:\n${docs.join("\n")}` : "- Фрагменты документации: нет",
    `- Модель: ${modelLabel}`,
  ];
}

/** Итоговый Markdown для CLI, файла и комментария PR; разделы модели понижены до `###`, чтобы читаться одним блоком. */
export function renderReview(result: ReviewResult, input: ReviewInput, modelLabel: string): string {
  void fence;
  const body = result.text.trim().replace(/^##(?=[ \t])/gm, "###");
  const missing =
    result.missing.length > 0
      ? [`Ответ модели без разделов: ${result.missing.map((key) => REVIEW_SECTIONS[key]).join(", ")}.`]
      : [];
  return ["## AI-ревью", body, ...missing, `### Контекст ревью\n\n${contextLines(input, modelLabel).join("\n")}`].join(
    "\n\n",
  );
}
