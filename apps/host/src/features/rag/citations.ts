import type { SearchHit } from "./search.ts";
import { bodyOf, type Section, splitSections } from "./sections.ts";
import type { Selection } from "./select.ts";

/** Минимальная длина цитаты, кодовые точки нормализованного текста. */
export const MIN_QUOTE_CHARS = 20;
/** Сколько кандидатов ниже порога показывает отказ по отбору. */
export const NEAREST_LIMIT = 3;

export type CitationProblem =
  | Readonly<{ code: "format" }>
  | Readonly<{ code: "unexpected-section"; heading: string }>
  | Readonly<{ code: "no-sources" }>
  | Readonly<{ code: "no-quotes" }>
  | Readonly<{ code: "no-clarification" }>
  | Readonly<{ code: "unknown-fragment"; fragment: number }>
  | Readonly<{ code: "source-without-quote"; fragment: number }>
  | Readonly<{ code: "quote-not-found"; fragment: number }>
  | Readonly<{ code: "quote-too-short"; fragment: number }>;

/** `hit` — фрагмент с `rank`, равным номеру; `undefined`, если такого номера в контексте не было. */
export type SourceRef = Readonly<{ fragment: number; hit: SearchHit | undefined }>;
export type Quote = Readonly<{ fragment: number; text: string; hit: SearchHit | undefined; verified: boolean }>;

export type CitedAnswer =
  | Readonly<{
      kind: "answer";
      text: string;
      sources: readonly SourceRef[];
      quotes: readonly Quote[];
      problems: readonly CitationProblem[];
      raw: string;
    }>
  | Readonly<{
      kind: "unknown";
      by: "model";
      text: string;
      clarification: string;
      problems: readonly CitationProblem[];
      raw: string;
    }>
  | Readonly<{ kind: "unknown"; by: "retrieval"; threshold: number | null; nearest: readonly SearchHit[] }>;

const ANSWER_HEADINGS: readonly string[] = ["Ответ", "Источники", "Цитаты"];
const REFUSAL_HEADINGS: readonly string[] = ["Не знаю", "Уточнение"];
const SOURCE_LINE = /^\s*[-*]\s*\[(\d+)\]/;
const QUOTE_LINE = /^\s*[-*]\s*\[(\d+)\]\s*(.+?)\s*$/;
const OPENING_QUOTE = /^[«“"„]/;
const CLOSING_QUOTE = /[»”"]$/;

/** Уравнивает регистр, «ё»/«е», пробелы, Markdown-символы, тире и кавычки: сравнение цитаты с чанком не зависит от оформления. */
export function normalizeQuote(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[`*_]/g, "")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[«»“”„]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const findHit = (hits: readonly SearchHit[], fragment: number): SearchHit | undefined =>
  hits.find((hit) => hit.rank === fragment);

/** Раздел вне набора и повтор уже встреченного заголовка одинаково лишние. */
function unexpectedSections(sections: readonly Section[], allowed: readonly string[]): CitationProblem[] {
  const seen = new Set<string>();
  const problems: CitationProblem[] = [];
  for (const { heading } of sections) {
    if (!allowed.includes(heading) || seen.has(heading)) problems.push({ code: "unexpected-section", heading });
    seen.add(heading);
  }
  return problems;
}

function parseSources(body: string, hits: readonly SearchHit[]): SourceRef[] {
  const fragments = new Set<number>();
  for (const line of body.split("\n")) {
    const number = SOURCE_LINE.exec(line)?.[1];
    if (number !== undefined) fragments.add(Number(number));
  }
  return [...fragments].map((fragment) => ({ fragment, hit: findHit(hits, fragment) }));
}

function parseQuotes(body: string, hits: readonly SearchHit[]): Quote[] {
  return body.split("\n").flatMap((line) => {
    const match = QUOTE_LINE.exec(line);
    const number = match?.[1];
    const written = match?.[2];
    if (number === undefined || written === undefined) return [];
    const fragment = Number(number);
    const text = written.replace(OPENING_QUOTE, "").replace(CLOSING_QUOTE, "").trim();
    const hit = findHit(hits, fragment);
    const verified = hit !== undefined && normalizeQuote(hit.chunk.text).includes(normalizeQuote(text));
    return [{ fragment, text, hit, verified }];
  });
}

function answerProblems(
  sections: readonly Section[],
  sources: readonly SourceRef[],
  quotes: readonly Quote[],
): CitationProblem[] {
  const problems = unexpectedSections(sections, ANSWER_HEADINGS);
  if (sources.length === 0) problems.push({ code: "no-sources" });
  if (quotes.length === 0) problems.push({ code: "no-quotes" });
  const unknown = new Set<number>();
  for (const { fragment, hit } of [...sources, ...quotes]) if (hit === undefined) unknown.add(fragment);
  for (const fragment of unknown) problems.push({ code: "unknown-fragment", fragment });
  for (const quote of quotes) {
    if (quote.hit === undefined) continue;
    if (!quote.verified) problems.push({ code: "quote-not-found", fragment: quote.fragment });
    if ([...normalizeQuote(quote.text)].length < MIN_QUOTE_CHARS) {
      problems.push({ code: "quote-too-short", fragment: quote.fragment });
    }
  }
  for (const { fragment, hit } of sources) {
    if (hit !== undefined && !quotes.some((quote) => quote.fragment === fragment)) {
      problems.push({ code: "source-without-quote", fragment });
    }
  }
  return problems;
}

function parseAnswer(raw: string, sections: readonly Section[], hits: readonly SearchHit[]): CitedAnswer {
  const sources = parseSources(bodyOf(sections, "Источники"), hits);
  const quotes = parseQuotes(bodyOf(sections, "Цитаты"), hits);
  return {
    kind: "answer",
    text: bodyOf(sections, "Ответ"),
    sources,
    quotes,
    problems: answerProblems(sections, sources, quotes),
    raw,
  };
}

function parseRefusal(raw: string, sections: readonly Section[]): CitedAnswer {
  const clarification = bodyOf(sections, "Уточнение");
  const problems = unexpectedSections(sections, REFUSAL_HEADINGS);
  if (clarification === "") problems.push({ code: "no-clarification" });
  return { kind: "unknown", by: "model", text: bodyOf(sections, "Не знаю"), clarification, problems, raw };
}

/** Разбирает ответ модели по разделам; ссылке `[N]` соответствует фрагмент с `rank` N. Нарушения формата возвращаются в `problems`, а не бросаются. */
export function parseCitedAnswer(raw: string, hits: readonly SearchHit[]): CitedAnswer {
  const sections = splitSections(raw);
  const answers = sections.some((section) => section.heading === "Ответ");
  const refuses = sections.some((section) => section.heading === "Не знаю");
  if (answers === refuses) {
    return { kind: "answer", text: raw.trim(), sources: [], quotes: [], problems: [{ code: "format" }], raw };
  }
  return refuses ? parseRefusal(raw, sections) : parseAnswer(raw, sections, hits);
}

/** Отказ без вызова модели: после отбора не осталось фрагментов; `threshold` — `null` в режимах без порога. */
export function retrievalRefusal(selection: Selection, threshold: number | null): CitedAnswer {
  return { kind: "unknown", by: "retrieval", threshold, nearest: selection.belowThreshold.slice(0, NEAREST_LIMIT) };
}

export function citationProblems(answer: CitedAnswer): readonly CitationProblem[] {
  return answer.kind === "unknown" && answer.by === "retrieval" ? [] : answer.problems;
}
