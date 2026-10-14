import { describe, expect, it, vi } from "vitest";
import type { ModelCompletion, ModelRequest } from "../../../core/index.ts";
import { REVIEW_SECTIONS, renderReview, reviewChanges } from "../index.ts";
import type { ReviewInput } from "../types.ts";

const INPUT: ReviewInput = {
  base: "main",
  files: [{ path: "src/a.ts", status: "M", diff: "+const x = 1;" }],
  omitted: ["src/big.ts"],
  docs: [
    { rank: 1, file: "AGENTS.md", title: "devflow-lab", sections: ["devflow-lab › Зависимости"], text: "Правило." },
  ],
};

const FULL = [
  "## Потенциальные баги",
  "- src/a.ts:1 — x не используется.",
  "## Архитектурные проблемы",
  "Не найдено.",
  "## Рекомендации",
  "- Добавить тест.",
].join("\n");

const modelAnswering = (content: string) => {
  const complete = vi.fn(async (_request: ModelRequest): Promise<ModelCompletion> => ({ type: "text", content }));
  return { model: { complete }, complete };
};

describe("reviewChanges", () => {
  it("один вызов без инструментов: промпт ревью в системной инструкции, изменения в сообщении", async () => {
    const { model, complete } = modelAnswering(FULL);
    const result = await reviewChanges({ model, systemPrompt: "Системная.", input: INPUT });
    expect(complete).toHaveBeenCalledTimes(1);
    const request = complete.mock.calls[0]?.[0];
    expect(request?.tools).toEqual([]);
    expect(String(request?.messages[0]?.content)).toMatch(/^Системная\.\n\nТы проводишь ревью pull request/);
    expect(String(request?.messages[1]?.content)).toContain("+const x = 1;");
    expect(result).toEqual({ text: FULL, missing: [] });
  });

  it("раздел без точного заголовка второго уровня попадает в missing", async () => {
    const { model } = modelAnswering("## Потенциальные баги\nНе найдено.\n### Архитектурные проблемы\nНе найдено.");
    const result = await reviewChanges({ model, systemPrompt: "", input: INPUT });
    expect(result.missing).toEqual(["architecture", "recommendations"]);
  });
});

describe("renderReview", () => {
  it("заголовок, разделы модели уровнем ниже и контекст ревью с фрагментами", () => {
    const markdown = renderReview({ text: FULL, missing: [] }, INPUT, "deepseek · deepseek-flash");
    expect(markdown.startsWith("## AI-ревью\n\n### Потенциальные баги\n")).toBe(true);
    expect(markdown).not.toMatch(/^## (?!AI-ревью)/m);
    expect(markdown).toContain(
      [
        "### Контекст ревью",
        "",
        "- База: `main`",
        "- Файлов в контексте: 1",
        "- Не вошло в контекст: `src/big.ts`",
        "- Фрагменты документации:",
        "  1. AGENTS.md › devflow-lab › Зависимости",
        "- Модель: deepseek · deepseek-flash",
      ].join("\n"),
    );
    expect(markdown).not.toContain("Ответ модели без разделов");
  });

  it("называет пропущенные разделы и отсутствие фрагментов", () => {
    const markdown = renderReview({ text: "текст", missing: ["bugs", "recommendations"] }, { ...INPUT, docs: [] }, "m");
    expect(markdown).toContain(
      `Ответ модели без разделов: ${REVIEW_SECTIONS.bugs}, ${REVIEW_SECTIONS.recommendations}.`,
    );
    expect(markdown).toContain("- Фрагменты документации: нет");
  });
});
