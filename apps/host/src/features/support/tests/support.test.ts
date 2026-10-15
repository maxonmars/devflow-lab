import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ModelCompletion, ModelRequest } from "../../../core/index.ts";
import { answerSupport, renderSupport, SUPPORT_SECTIONS } from "../index.ts";
import type { SupportInput } from "../types.ts";

const INPUT: SupportInput = {
  ticketId: "T-1002",
  ticket: "Тикет T-1002: Не работает авторизация\nСпособ входа: SSO (sso)",
  question: "Почему не работает авторизация?",
  docs: [
    { rank: 1, file: "docs/auth.md", title: "Вход", sections: ["Вход › Способы входа"], text: "SSO." },
    { rank: 2, file: "docs/faq.md", title: "FAQ", sections: [], text: "Вопросы." },
  ],
};

const FULL = [
  "## Ответ",
  "Ваш аккаунт входит через SSO [1].",
  "## Источники",
  "- [1]",
  "## Данные тикета",
  "- Способ входа: SSO",
].join("\n");

const modelAnswering = (content: string) => {
  const complete = vi.fn(async (_request: ModelRequest): Promise<ModelCompletion> => ({ type: "text", content }));
  return { model: { complete }, complete };
};

describe("answerSupport", () => {
  it("один вызов без инструментов: инструкция — только support.md, тикет и вопрос в сообщении", async () => {
    const { model, complete } = modelAnswering(FULL);
    const result = await answerSupport({ model, input: INPUT });
    expect(complete).toHaveBeenCalledTimes(1);
    const request = complete.mock.calls[0]?.[0];
    expect(request?.tools).toEqual([]);
    const prompt = readFileSync(new URL("../prompts/support.md", import.meta.url), "utf8").trim();
    expect(request?.messages[0]?.content).toBe(prompt);
    expect(String(request?.messages[1]?.content)).toContain("Способ входа: SSO (sso)");
    expect(result).toEqual({ text: FULL, missing: [], unknownSources: [] });
  });

  it("раздел без точного заголовка — в missing, номер вне фрагментов — в unknownSources", async () => {
    const text = "## Ответ\nСм. [1] и [7].\n## Источники\n- [1]\n- [7]\n- [3], [7]\n### Данные тикета\nнет";
    const { model } = modelAnswering(text);
    const result = await answerSupport({ model, input: INPUT });
    expect(result.missing).toEqual(["ticket"]);
    expect(result.unknownSources).toEqual([7, 3]);
  });

  it("номера вне раздела «Источники» не проверяются; без раздела — пустой список", async () => {
    const { model } = modelAnswering("## Ответ\nСм. [9].\n## Источники\nнет\n## Данные тикета\n- [8]");
    expect((await answerSupport({ model, input: INPUT })).unknownSources).toEqual([]);
    const { model: bare } = modelAnswering("Просто текст [5].");
    expect(await answerSupport({ model: bare, input: INPUT })).toMatchObject({
      missing: ["answer", "sources", "ticket"],
      unknownSources: [],
    });
  });
});

describe("renderSupport", () => {
  it("заголовок с тикетом, разделы модели уровнем ниже и контекст ответа", () => {
    const markdown = renderSupport({ text: FULL, missing: [], unknownSources: [] }, INPUT, "deepseek · deepseek-flash");
    expect(markdown.startsWith("## Ответ поддержки по тикету T-1002\n\n### Ответ\n")).toBe(true);
    expect(markdown).not.toMatch(/^## (?!Ответ поддержки)/m);
    expect(markdown).toContain(
      [
        "### Контекст ответа",
        "",
        "- Тикет: `T-1002`",
        "- Вопрос: Почему не работает авторизация?",
        "- Фрагменты документации:",
        "  1. docs/auth.md › Вход › Способы входа",
        "  2. docs/faq.md › FAQ",
        "- Модель: deepseek · deepseek-flash",
      ].join("\n"),
    );
    expect(markdown).not.toContain("Ответ модели без разделов");
    expect(markdown).not.toContain("Источники вне контекста");
  });

  it("источники `- [N]` получают файл и раздел фрагмента; номер вне контекста и «нет» называются прямо", () => {
    const text = "## Ответ\nСм. [2].\n## Источники\n- [1]\n- [2], [1]\n- [7]\n## Данные тикета\nнет";
    const markdown = renderSupport({ text, missing: [], unknownSources: [7] }, INPUT, "m");
    expect(markdown).toContain(
      [
        "### Источники",
        "",
        "- [1] docs/auth.md › Вход › Способы входа",
        "- [2] docs/faq.md › FAQ",
        "- [7] фрагмента не было в контексте",
        "",
        "### Данные тикета",
      ].join("\n"),
    );
    const none = renderSupport({ text: "## Ответ\nx\n## Источники\nнет", missing: [], unknownSources: [] }, INPUT, "m");
    expect(none).toContain("### Источники\nнет");
  });

  it("называет пропущенные разделы, чужие источники и отсутствие фрагментов", () => {
    const markdown = renderSupport(
      { text: "текст", missing: ["sources", "ticket"], unknownSources: [7, 3] },
      { ...INPUT, docs: [] },
      "m",
    );
    expect(markdown).toContain(`Ответ модели без разделов: ${SUPPORT_SECTIONS.sources}, ${SUPPORT_SECTIONS.ticket}.`);
    expect(markdown).toContain("Источники вне контекста: [7], [3].");
    expect(markdown).toContain("- Фрагменты документации: нет");
  });
});
