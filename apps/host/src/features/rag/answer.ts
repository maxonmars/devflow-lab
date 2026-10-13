import { Agent, AgentError, type ModelPort } from "../../core/index.ts";
import { type CitedAnswer, parseCitedAnswer, retrievalRefusal } from "./citations.ts";
import { renderRagMessage } from "./context.ts";
import { generateWithTools, type ProjectTools } from "./projectAnswer.ts";
import { readPrompt } from "./prompts.ts";
import {
  checkRetrievalParams,
  type RetrievalMode,
  type RetrievalParams,
  usesFilter,
  usesRewrite,
} from "./retrieval.ts";
import { rewriteQuery } from "./rewrite.ts";
import type { SearchHit, SearchIndex } from "./search.ts";
import { type Selection, selectForMode } from "./select.ts";
import { timed, timedSync } from "./timing.ts";

export const ANSWER_PROMPTS = ["default", "compact"] as const;
export type AnswerPrompt = (typeof ANSWER_PROMPTS)[number];

/** Файл шаблона ответа в prompts/. */
export const ANSWER_PROMPT_FILES: Readonly<Record<AnswerPrompt, string>> = {
  default: "answer.md",
  compact: "answer-compact.md",
};

/** Длительности этапов, мс; для режимов без rewrite `rewriteMs` равен 0. */
export type StageTimings = Readonly<{ rewriteMs: number; searchMs: number; selectMs: number; generateMs: number }>;

export type RagAnswer = Readonly<{
  answer: CitedAnswer;
  hits: readonly SearchHit[];
  contextChars: number;
  /** Строка, по которой выполнен поиск: исходный вопрос или результат rewrite. */
  query: string;
  candidates: readonly SearchHit[];
  timings: StageTimings;
}>;

export type RagAnswerOptions = RetrievalParams &
  Readonly<{
    question: string;
    index: SearchIndex;
    mode: RetrievalMode;
    model: ModelPort;
    systemPrompt: string;
    answerPrompt: AnswerPrompt;
    /** Инструменты проекта: вместо шаблона ответа — prompts/project.md, пустой отбор не отменяет вызов модели. */
    tools?: ProjectTools;
  }>;

export type GenerationOptions = Readonly<{
  model: ModelPort;
  systemPrompt: string;
  answerPrompt: AnswerPrompt;
  question: string;
  selection: Selection;
  /** Порог режима с фильтром; `null` — режим без порога. */
  threshold: number | null;
  tools?: ProjectTools;
}>;

/**
 * Ответ по готовому отбору: поиск и rewrite не выполняются, вопрос остаётся исходным.
 * При пустом `selection.hits` модель не вызывается, `contextChars` равен 0; иначе это кодовые точки сообщения.
 */
export async function generateAnswer(
  options: GenerationOptions,
): Promise<Readonly<{ answer: CitedAnswer; contextChars: number }>> {
  const { hits } = options.selection;
  if (options.tools) {
    const { model, systemPrompt, question, tools } = options;
    return generateWithTools({ model, systemPrompt, question, hits, tools });
  }
  if (hits.length === 0) return { answer: retrievalRefusal(options.selection, options.threshold), contextChars: 0 };
  const message = renderRagMessage(options.question, hits);
  const instruction = [options.systemPrompt, readPrompt(ANSWER_PROMPT_FILES[options.answerPrompt])];
  const raw = await new Agent(options.model, instruction.join("\n\n")).respond(message);
  return { answer: parseCitedAnswer(raw, hits), contextChars: [...message].length };
}

/** Rewrite (по режиму) → поиск кандидатов → отбор → генерация (при пустом отборе — отказ без модели); системная инструкция — та же, что без RAG, плюс шаблон ответа (prompts/answer.md или answer-compact.md). */
export async function answerWithRag(options: RagAnswerOptions): Promise<RagAnswer> {
  const question = options.question.trim();
  if (!question) throw new AgentError("EMPTY_INPUT");
  checkRetrievalParams(options);
  const rewritten = usesRewrite(options.mode)
    ? await timed(() => rewriteQuery(question, options.model))
    : { value: question, ms: 0 };
  const search = await timed(() => options.index.search(rewritten.value, options.candidateTopK));
  const selection = timedSync(() => selectForMode(options.mode, search.value, options));
  const { hits } = selection.value;
  const generation = await timed(() =>
    generateAnswer({
      model: options.model,
      systemPrompt: options.systemPrompt,
      answerPrompt: options.answerPrompt,
      question,
      selection: selection.value,
      threshold: usesFilter(options.mode) ? options.threshold : null,
      ...(options.tools ? { tools: options.tools } : {}),
    }),
  );
  return {
    answer: generation.value.answer,
    hits,
    contextChars: generation.value.contextChars,
    query: rewritten.value,
    candidates: search.value,
    timings: { rewriteMs: rewritten.ms, searchMs: search.ms, selectMs: selection.ms, generateMs: generation.ms },
  };
}
