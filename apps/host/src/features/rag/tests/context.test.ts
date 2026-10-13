import { expect, it } from "vitest";
import { renderRagMessage } from "../context.ts";
import type { SearchHit } from "../search.ts";

const hit = (rank: number, text: string, sections: string[] = ["Global › Правило"]): SearchHit => ({
  rank,
  score: 0.5,
  chunk: {
    chunk_id: `c${rank}`,
    strategy: "structure",
    source: "https://example.test/global.md",
    title: "Global",
    file: "structure/global.md",
    sections,
    start: 0,
    end: text.length,
    text,
  },
});

it("нумерует фрагменты, указывает файл, документ и разделы, вопрос стоит в конце", () => {
  const message = renderRagMessage("Что такое global?", [
    hit(1, "первый текст", ["Global › Правило", "Global › Почему"]),
    hit(2, "второй текст"),
  ]);
  expect(message).toBe(
    [
      "## Фрагменты документации",
      "",
      "### Фрагмент 1",
      "",
      "- Файл: `structure/global.md`",
      "- Документ: Global",
      "- Разделы: Global › Правило; Global › Почему",
      "",
      "```markdown",
      "первый текст",
      "```",
      "",
      "### Фрагмент 2",
      "",
      "- Файл: `structure/global.md`",
      "- Документ: Global",
      "- Разделы: Global › Правило",
      "",
      "```markdown",
      "второй текст",
      "```",
      "",
      "## Вопрос",
      "",
      "Что такое global?",
    ].join("\n"),
  );
});

it("забор длиннее обратных кавычек внутри текста чанка, сам текст не меняется", () => {
  const text = "до\n\n````ts\n```\nкод\n```\n````\n\nпосле";
  const message = renderRagMessage("Вопрос", [hit(1, text)]);
  expect(message).toContain(`\`\`\`\`\`markdown\n${text}\n\`\`\`\`\``);
});

it("не содержит сходства и ссылки на источник", () => {
  const message = renderRagMessage("Вопрос", [hit(1, "текст")]);
  expect(message).not.toContain("0.5");
  expect(message).not.toContain("example.test");
});

it("без найденных фрагментов оставляет заголовки и вопрос", () => {
  expect(renderRagMessage("Вопрос", [])).toBe("## Фрагменты документации\n\n## Вопрос\n\nВопрос");
});
