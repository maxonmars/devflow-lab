import { describe, expect, it } from "vitest";
import { describeCitationProblem, renderCitedAnswer } from "../citationRender.ts";
import { type CitationProblem, MIN_QUOTE_CHARS, parseCitedAnswer, retrievalRefusal } from "../citations.ts";
import { searchHit } from "./support.ts";

const FIRST = "Global хранит только инфраструктуру глобального действия.";
const SECOND = "Public API модуля — корневой index.ts, через него импортируют остальные.";
const HITS = [searchHit(1, "a.md", 0.9, FIRST), searchHit(2, "b.md", 0.8, SECOND)];

const reply = (sources: string, quotes: string) =>
  `## Ответ\n\nТак [1].\n\n## Источники\n\n${sources}\n\n## Цитаты\n\n${quotes}`;
const render = (raw: string) => renderCitedAnswer(parseCitedAnswer(raw, HITS));

describe("renderCitedAnswer: ответ", () => {
  it("источник показывает файл, разделы, chunk_id и source; цитата — найдена ли она во фрагменте", () => {
    const text = render(reply("- [1]", `- [1] «${FIRST}»`));
    expect(text).toBe(
      [
        "Так [1].",
        "",
        "Источники:",
        "- [1] `a.md` › Doc › a.md · `a.md#1` · src",
        "",
        "Цитаты:",
        `- [1] «${FIRST}» — найдена во фрагменте 1`,
      ].join("\n"),
    );
  });

  it("блок «Замечания» выводится только при замечаниях; цитата не из своего фрагмента помечена", () => {
    const text = render(reply("- [1]\n- [2]", `- [1] «${SECOND}»\n- [9] «Цитата из фрагмента вне контекста»`));
    expect(text).toContain(`- [1] «${SECOND}» — не найдена во фрагменте 1`);
    expect(text).toContain("- [9] «Цитата из фрагмента вне контекста» — фрагмента не было в контексте");
    expect(text).toContain("Замечания:\n- фрагмента 9 не было в контексте\n- цитата [1] не найдена во фрагменте 1");
    expect(render(reply("- [1]", `- [1] «${FIRST}»`))).not.toContain("Замечания:");
  });

  it("источник вне контекста показан без раскрытия", () => {
    expect(render(reply("- [7]", `- [7] «${FIRST}»`))).toContain("Источники:\n- [7] фрагмента не было в контексте");
  });

  it("пустые источники и цитаты — «Источники: нет» и «Цитаты: нет»", () => {
    const text = render("## Ответ\n\nТак.");
    expect(text).toContain("Источники: нет");
    expect(text).toContain("Цитаты: нет");
    expect(text).toContain("- нет ни одного источника\n- нет ни одной цитаты");
  });

  it("нарушение формата: исходный ответ модели виден целиком", () => {
    const raw = "Свободный текст без разделов.";
    expect(render(raw)).toContain(raw);
    expect(render(raw)).toContain("- ответ не разбит на разделы");
  });
});

describe("renderCitedAnswer: «не знаю»", () => {
  it("отказ модели: «Не знаю.» и «Уточнение:»", () => {
    const text = render("## Не знаю\n\nНет версии.\n\n## Уточнение\n\nО какой версии речь?");
    expect(text).toBe("Не знаю. Нет версии.\n\nУточнение: О какой версии речь?");
  });

  it("отказ модели без уточнения: строки нет, есть замечание", () => {
    const text = render("## Не знаю\n\nНет версии.");
    expect(text).not.toContain("Уточнение:");
    expect(text).toContain("Замечания:\n- нет уточняющего вопроса");
  });

  it("отказ по порогу: порог, лучшее сходство с тремя знаками и ближайшие разделы", () => {
    const below = [searchHit(1, "a.md", 0.5321), searchHit(2, "b.md", 0.4)];
    const text = renderCitedAnswer(retrievalRefusal({ hits: [], belowThreshold: below, overLimit: [] }, 0.55));
    expect(text).toBe(
      [
        "Не знаю: ни один фрагмент не достиг порога сходства 0.55 (лучшее 0.532).",
        "Уточните вопрос: назовите раздел, термин или пример, о котором идёт речь.",
        "",
        "Ближайшие разделы ниже порога:",
        "- `a.md` › Doc › a.md · 0.532",
        "- `b.md` › Doc › b.md · 0.400",
      ].join("\n"),
    );
  });

  it("отказ без кандидатов или без порога называет причину — поиск ничего не вернул", () => {
    const empty = { hits: [], belowThreshold: [], overLimit: [] };
    const expected =
      "Не знаю: поиск не вернул ни одного фрагмента.\nУточните вопрос: назовите раздел, термин или пример, о котором идёт речь.";
    expect(renderCitedAnswer(retrievalRefusal(empty, 0.55))).toBe(expected);
    expect(renderCitedAnswer(retrievalRefusal(empty, null))).toBe(expected);
  });
});

describe("describeCitationProblem", () => {
  it("называет причину каждого замечания", () => {
    const problems: readonly (readonly [CitationProblem, string])[] = [
      [{ code: "format" }, "ответ не разбит на разделы «Ответ», «Источники», «Цитаты» или «Не знаю», «Уточнение»"],
      [{ code: "unexpected-section", heading: "Примечание" }, "лишний раздел «Примечание»"],
      [{ code: "no-sources" }, "нет ни одного источника"],
      [{ code: "no-quotes" }, "нет ни одной цитаты"],
      [{ code: "no-clarification" }, "нет уточняющего вопроса"],
      [{ code: "unknown-fragment", fragment: 4 }, "фрагмента 4 не было в контексте"],
      [{ code: "source-without-quote", fragment: 2 }, "у источника [2] нет цитаты"],
      [{ code: "quote-not-found", fragment: 3 }, "цитата [3] не найдена во фрагменте 3"],
      [{ code: "quote-too-short", fragment: 1 }, `цитата [1] короче ${MIN_QUOTE_CHARS} символов`],
    ];
    for (const [problem, text] of problems) expect(describeCitationProblem(problem)).toBe(text);
  });
});
