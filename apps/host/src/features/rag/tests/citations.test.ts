import { describe, expect, it } from "vitest";
import {
  type CitedAnswer,
  citationProblems,
  MIN_QUOTE_CHARS,
  NEAREST_LIMIT,
  normalizeQuote,
  parseCitedAnswer,
  retrievalRefusal,
} from "../citations.ts";
import { searchHit } from "./support.ts";

const FIRST = "Global хранит только инфраструктуру глобального действия: shims и polyfills.";
const SECOND = "Public API модуля — это корневой index.ts, через него импортируют остальные модули.";
const HITS = [searchHit(1, "a.md", 0.9, FIRST), searchHit(2, "b.md", 0.8, SECOND)];

type Parts = Readonly<{ text?: string; sources?: string; quotes?: string }>;

function reply({ text = "Так и есть [1].", sources = "- [1]", quotes = `- [1] «${FIRST}»` }: Parts = {}): string {
  return `## Ответ\n\n${text}\n\n## Источники\n\n${sources}\n\n## Цитаты\n\n${quotes}`;
}

function parsed(raw: string, hits = HITS) {
  const answer = parseCitedAnswer(raw, hits);
  if (answer.kind !== "answer") throw new Error(`ожидался ответ, получено «не знаю»: ${JSON.stringify(answer)}`);
  return answer;
}

describe("parseCitedAnswer: ответ", () => {
  it("корректный ответ раскрывает [N] в чанк и проверяет цитату без замечаний", () => {
    const answer = parsed(reply());
    expect(answer).toMatchObject({ kind: "answer", text: "Так и есть [1].", problems: [] });
    expect(answer.sources).toHaveLength(1);
    expect(answer.sources[0]?.hit?.chunk.chunk_id).toBe("a.md#1");
    expect(answer.quotes[0]).toMatchObject({ fragment: 1, text: FIRST, verified: true });
    expect(answer.raw).toBe(reply());
  });

  it("ссылка [N] ищет фрагмент по rank, а не по позиции в списке", () => {
    const ranked = [searchHit(2, "a.md", 0.9, FIRST), searchHit(3, "b.md", 0.8, SECOND)];
    const answer = parsed(reply({ sources: "- [2]", quotes: `- [2] «${FIRST}»` }), ranked);
    expect(answer.sources[0]?.hit).toBe(ranked[0]);
    expect(answer.problems).toEqual([]);
    expect(parsed(reply(), ranked).problems).toContainEqual({ code: "unknown-fragment", fragment: 1 });
  });

  it("повторяющиеся номера источников схлопываются, порядок — по первому появлению", () => {
    const quotes = `- [2] «${SECOND}»\n- [1] «${FIRST}»`;
    const answer = parsed(reply({ sources: "- [2]\n* [1]\n- [2]", quotes }));
    expect(answer.sources.map((source) => source.fragment)).toEqual([2, 1]);
    expect(answer.problems).toEqual([]);
  });

  it("цитата засчитывается при другом регистре, пробелах, ё/е, Markdown-символах, тире и кавычках", () => {
    const chunk = searchHit(
      1,
      "a.md",
      0.9,
      "Ёлка и **Global**  хранит `только` инфраструктуру — глобального действия.",
    );
    const quote = "«  ЕЛКА и global хранит только   инфраструктуру – глобального действия. »";
    const answer = parsed(reply({ quotes: `- [1] ${quote}` }), [chunk]);
    expect(answer.quotes[0]?.verified).toBe(true);
    expect(answer.problems).toEqual([]);
  });

  it("цитата из другого фрагмента не найдена в указанном", () => {
    const answer = parsed(reply({ quotes: `- [1] «${SECOND}»` }));
    expect(answer.quotes[0]?.verified).toBe(false);
    expect(answer.problems).toEqual([{ code: "quote-not-found", fragment: 1 }]);
  });

  it("номер вне контекста в источниках и в цитатах даёт одно замечание на номер", () => {
    const quotes = `- [1] «${FIRST}»\n- [7] «Цитата из несуществующего фрагмента»\n- [7] «Ещё одна цитата оттуда же»`;
    const answer = parsed(reply({ sources: "- [1]\n- [7]", quotes }));
    expect(answer.problems).toEqual([{ code: "unknown-fragment", fragment: 7 }]);
    expect(answer.sources[1]?.hit).toBeUndefined();
    expect(answer.quotes[1]).toMatchObject({ fragment: 7, verified: false });
  });

  it("нет раздела «Источники» — no-sources; пустой раздел «Цитаты» — no-quotes и источник без цитаты", () => {
    const noSources = `## Ответ\n\nТак.\n\n## Цитаты\n\n- [1] «${FIRST}»`;
    expect(parsed(noSources).problems).toEqual([{ code: "no-sources" }]);
    const noQuotes = parsed(reply({ quotes: "" }));
    expect(noQuotes.problems).toEqual([{ code: "no-quotes" }, { code: "source-without-quote", fragment: 1 }]);
  });

  it("источник без цитаты с тем же номером — source-without-quote", () => {
    const answer = parsed(reply({ sources: "- [1]\n- [2]" }));
    expect(answer.problems).toEqual([{ code: "source-without-quote", fragment: 2 }]);
  });

  it("цитата короче MIN_QUOTE_CHARS: найдена, но слишком короткая", () => {
    const answer = parsed(reply({ quotes: "- [1] «Global хранит»" }));
    expect(MIN_QUOTE_CHARS).toBeGreaterThan("global хранит".length);
    expect(answer.quotes[0]?.verified).toBe(true);
    expect(answer.problems).toEqual([{ code: "quote-too-short", fragment: 1 }]);
  });

  it("лишний раздел и повтор известного заголовка — unexpected-section, ответ при этом разобран", () => {
    const extra = parsed(`${reply()}\n\n## Примечание\n\nЛишнее.\n\n## Ответ\n\nВторой ответ.`);
    expect(extra.text).toBe("Так и есть [1].");
    expect(extra.problems).toEqual([
      { code: "unexpected-section", heading: "Примечание" },
      { code: "unexpected-section", heading: "Ответ" },
    ]);
  });

  it("текст до первого раздела и заголовки третьего уровня внутри разделов не мешают разбору", () => {
    const answer = parsed(`Вступление.\n\n${reply({ text: "### Подзаголовок\n\nТекст." })}`);
    expect(answer.text).toBe("### Подзаголовок\n\nТекст.");
    expect(answer.problems).toEqual([]);
  });

  it("принимает переводы строк CRLF", () => {
    expect(parsed(reply().replaceAll("\n", "\r\n")).problems).toEqual([]);
  });
});

describe("parseCitedAnswer: «не знаю» и нарушение формата", () => {
  it("отказ модели с уточнением — kind unknown, by model, без замечаний", () => {
    const raw = "## Не знаю\n\nВо фрагментах нет версии.\n\n## Уточнение\n\nО какой версии речь?";
    expect(parseCitedAnswer(raw, HITS)).toEqual({
      kind: "unknown",
      by: "model",
      text: "Во фрагментах нет версии.",
      clarification: "О какой версии речь?",
      problems: [],
      raw,
    });
  });

  it("отказ без уточнения и с лишним разделом: сначала unexpected-section, затем no-clarification", () => {
    const answer = parseCitedAnswer("## Не знаю\n\nНет сведений.\n\n## Источники\n\n- [1]", HITS);
    expect(citationProblems(answer)).toEqual([
      { code: "unexpected-section", heading: "Источники" },
      { code: "no-clarification" },
    ]);
  });

  it("текст без разделов и «Ответ» вместе с «Не знаю» — только format, текст равен raw.trim()", () => {
    for (const raw of ["  Просто текст без разделов.\n", `${reply()}\n\n## Не знаю\n\nНет.`]) {
      expect(parseCitedAnswer(raw, HITS)).toEqual({
        kind: "answer",
        text: raw.trim(),
        sources: [],
        quotes: [],
        problems: [{ code: "format" }],
        raw,
      });
    }
  });

  it("не бросает исключений на произвольном тексте", () => {
    const inputs = [
      "",
      "##",
      "## ",
      "## Ответ",
      "## Не знаю",
      "## Цитаты\n- [",
      `## Ответ\n\n## Цитаты\n- [${"9".repeat(40)}] «»`,
    ];
    for (const raw of inputs) expect(() => parseCitedAnswer(raw, HITS)).not.toThrow();
  });
});

describe("retrievalRefusal и citationProblems", () => {
  const below = [0.5, 0.45, 0.4, 0.3, 0.2].map((score, position) => searchHit(position + 1, "a.md", score));

  it("nearest — первые NEAREST_LIMIT кандидатов ниже порога, порог передаётся как есть", () => {
    const selection = { hits: [], belowThreshold: below, overLimit: [] };
    expect(retrievalRefusal(selection, 0.55)).toEqual({
      kind: "unknown",
      by: "retrieval",
      threshold: 0.55,
      nearest: below.slice(0, NEAREST_LIMIT),
    });
    expect(retrievalRefusal(selection, null)).toMatchObject({ threshold: null });
  });

  it("отказ по отбору не имеет замечаний, у остальных видов замечания берутся из problems", () => {
    const refusal: CitedAnswer = retrievalRefusal({ hits: [], belowThreshold: [], overLimit: [] }, null);
    expect(citationProblems(refusal)).toEqual([]);
    expect(citationProblems(parseCitedAnswer("текст", HITS))).toEqual([{ code: "format" }]);
  });
});

describe("normalizeQuote", () => {
  it("уравнивает регистр, ё, Markdown-символы, тире, кавычки и пробелы", () => {
    expect(normalizeQuote("Ёлка — **ТЕСТ**  `код`\n«да»")).toBe('елка - тест код "да"');
  });

  it("приводит составную «ё» (е и диакритика) к «е»", () => {
    expect(normalizeQuote("Ёлка")).toBe("елка");
  });
});
