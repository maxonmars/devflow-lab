import {
  type CitationProblem,
  type CitedAnswer,
  MIN_QUOTE_CHARS,
  type ProjectFact,
  type Quote,
  type SourceRef,
} from "./citations.ts";
import type { SearchHit } from "./search.ts";

const CLARIFY_HINT = "Уточните вопрос: назовите раздел, термин или пример, о котором идёт речь.";
const MISSING_FRAGMENT = "фрагмента не было в контексте";

export function describeCitationProblem(problem: CitationProblem): string {
  switch (problem.code) {
    case "format":
      return "ответ не разбит на разделы «Ответ», «Источники», «Цитаты» или «Не знаю», «Уточнение»";
    case "unexpected-section":
      return `лишний раздел «${problem.heading}»`;
    case "no-sources":
      return "нет ни одного источника";
    case "no-quotes":
      return "нет ни одной цитаты";
    case "no-clarification":
      return "нет уточняющего вопроса";
    case "unknown-fragment":
      return `фрагмента ${problem.fragment} не было в контексте`;
    case "source-without-quote":
      return `у источника [${problem.fragment}] нет цитаты`;
    case "quote-not-found":
      return `цитата [${problem.fragment}] не найдена во фрагменте ${problem.fragment}`;
    case "quote-too-short":
      return `цитата [${problem.fragment}] короче ${MIN_QUOTE_CHARS} символов`;
    case "tool-not-called":
      return `инструмент ${problem.tool} в этом ответе не вызывался`;
  }
}

const problemLines = (problems: readonly CitationProblem[]): string[] =>
  problems.length === 0
    ? []
    : ["", "Замечания:", ...problems.map((problem) => `- ${describeCitationProblem(problem)}`)];

function sourceLine({ fragment, hit }: SourceRef): string {
  if (hit === undefined) return `- [${fragment}] ${MISSING_FRAGMENT}`;
  const { chunk } = hit;
  return `- [${fragment}] \`${chunk.file}\` › ${chunk.sections.join("; ")} · \`${chunk.chunk_id}\` · ${chunk.source}`;
}

function quoteLine({ fragment, text, hit, verified }: Quote): string {
  const status =
    hit === undefined ? MISSING_FRAGMENT : `${verified ? "найдена" : "не найдена"} во фрагменте ${fragment}`;
  return `- [${fragment}] «${text}» — ${status}`;
}

const factLine = ({ tool, text, called }: ProjectFact): string =>
  `- ${tool}: ${text}${called ? "" : " — инструмент не вызывался"}`;

/** Ответ по данным инструментов без опоры на фрагменты не показывает пустые «Источники» и «Цитаты». */
function renderAnswer(answer: Extract<CitedAnswer, { kind: "answer" }>): string[] {
  const facts = answer.projectData.length > 0 ? ["", "Данные проекта:", ...answer.projectData.map(factLine)] : [];
  const withProjectData = answer.projectData.length > 0;
  const sources = answer.sources.length > 0 ? ["Источники:", ...answer.sources.map(sourceLine)] : ["Источники: нет"];
  const quotes = answer.quotes.length > 0 ? ["Цитаты:", ...answer.quotes.map(quoteLine)] : ["Цитаты: нет"];
  return [
    answer.text,
    ...facts,
    ...(withProjectData && answer.sources.length === 0 ? [] : ["", ...sources]),
    ...(withProjectData && answer.quotes.length === 0 ? [] : ["", ...quotes]),
    ...problemLines(answer.problems),
  ];
}

function renderModelRefusal(answer: Extract<CitedAnswer, { kind: "unknown"; by: "model" }>): string[] {
  const clarification = answer.clarification === "" ? [] : ["", `Уточнение: ${answer.clarification}`];
  return [`Не знаю. ${answer.text}`, ...clarification, ...problemLines(answer.problems)];
}

function nearestLine({ score, chunk }: SearchHit): string {
  return `- \`${chunk.file}\` › ${chunk.sections[0] ?? chunk.title} · ${score.toFixed(3)}`;
}

function renderRetrievalRefusal(answer: Extract<CitedAnswer, { kind: "unknown"; by: "retrieval" }>): string[] {
  const [best] = answer.nearest;
  if (answer.threshold === null || best === undefined) {
    return ["Не знаю: поиск не вернул ни одного фрагмента.", CLARIFY_HINT];
  }
  return [
    `Не знаю: ни один фрагмент не достиг порога сходства ${answer.threshold} (лучшее ${best.score.toFixed(3)}).`,
    CLARIFY_HINT,
    "",
    "Ближайшие разделы ниже порога:",
    ...answer.nearest.map(nearestLine),
  ];
}

/** Единственное место, где `CitedAnswer` превращается в текст: CLI и оба отчёта показывают ответ одинаково. */
export function renderCitedAnswer(answer: CitedAnswer): string {
  if (answer.kind === "answer") return renderAnswer(answer).join("\n");
  return (answer.by === "model" ? renderModelRefusal(answer) : renderRetrievalRefusal(answer)).join("\n");
}
