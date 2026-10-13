import { describe, expect, it } from "vitest";
import { AgentError } from "../../../core/index.ts";
import {
  ANSWER_PROMPT_FILES,
  ANSWER_PROMPTS,
  answerWithRag,
  generateAnswer,
  type RagAnswerOptions,
} from "../answer.ts";
import { renderRagMessage } from "../context.ts";
import { readPrompt } from "../prompts.ts";
import type { SearchHit } from "../search.ts";
import { fakeModel, fakeSearchIndex, searchHit } from "./support.ts";

const CANDIDATES = [searchHit(1, "a.md", 0.9), searchHit(2, "b.md", 0.6), searchHit(3, "c.md", 0.4)];

function setup(overrides: Partial<RagAnswerOptions> = {}, modelOptions: Parameters<typeof fakeModel>[0] = {}) {
  const { index, search } = fakeSearchIndex(() => CANDIDATES);
  const { model, requests, kinds } = fakeModel(modelOptions);
  const options: RagAnswerOptions = {
    question: "  Что такое global?  ",
    index,
    strategy: "structure",
    mode: "baseline",
    candidateTopK: 10,
    topK: 2,
    threshold: 0.5,
    model,
    systemPrompt: "Системная инструкция.",
    answerPrompt: "default",
    ...overrides,
  };
  return { options, search, requests, kinds };
}

describe("answerWithRag", () => {
  it("baseline: без rewrite ищет исходный вопрос, отправляет системную инструкцию с answer.md и фрагменты", async () => {
    const { options, search, requests, kinds } = setup();
    const result = await answerWithRag(options);
    const message = renderRagMessage("Что такое global?", CANDIDATES.slice(0, 2));
    expect(search).toHaveBeenCalledExactlyOnceWith("Что такое global?", "structure", 10);
    expect(kinds).toEqual(["answer"]);
    expect(requests[0]?.messages).toEqual([
      { role: "system", content: `Системная инструкция.\n\n${readPrompt("answer.md")}` },
      { role: "user", content: message },
    ]);
    expect(result).toMatchObject({
      hits: CANDIDATES.slice(0, 2),
      candidates: CANDIDATES,
      query: "Что такое global?",
      contextChars: [...message].length,
    });
    expect(result.answer).toMatchObject({ kind: "answer", problems: [{ code: "format" }] });
    expect(result.answer).toMatchObject({ raw: expect.stringContaining("ответ:") });
  });

  it("compact: системное сообщение содержит answer-compact.md вместо answer.md", async () => {
    const { options, requests } = setup({ answerPrompt: "compact" });
    await answerWithRag(options);
    expect(requests[0]?.messages[0]).toEqual({
      role: "system",
      content: `Системная инструкция.\n\n${readPrompt("answer-compact.md")}`,
    });
  });

  it("filter не вызывает rewrite и убирает кандидатов ниже порога", async () => {
    const { options, kinds } = setup({ mode: "filter", topK: 3, threshold: 0.5 });
    const result = await answerWithRag(options);
    expect(kinds).toEqual(["answer"]);
    expect(result.hits).toEqual(CANDIDATES.slice(0, 2));
    expect(result.candidates).toHaveLength(3);
    expect(result.timings.rewriteMs).toBe(0);
  });

  it("rewrite: поиск идёт по переписанной строке, а генерация получает исходный вопрос", async () => {
    const { options, search, requests, kinds } = setup({ mode: "rewrite" }, { rewrite: () => "определение global" });
    const result = await answerWithRag(options);
    expect(search).toHaveBeenCalledExactlyOnceWith("определение global", "structure", 10);
    expect(kinds).toEqual(["rewrite", "answer"]);
    expect(String(requests[1]?.messages[1]?.content).endsWith("## Вопрос\n\nЧто такое global?")).toBe(true);
    expect(requests[1]?.messages[1]?.content).not.toContain("определение global");
    expect(result.query).toBe("определение global");
  });

  it("rewrite-filter: один rewrite, один поиск, порог применяется к кандидатам переписанного запроса", async () => {
    const { options, search, kinds } = setup({ mode: "rewrite-filter", topK: 3, threshold: 0.7 });
    const result = await answerWithRag(options);
    expect(kinds).toEqual(["rewrite", "answer"]);
    expect(search).toHaveBeenCalledTimes(1);
    expect(result.hits).toEqual([CANDIDATES[0]]);
  });

  it("возвращает длительности всех этапов; для режима без rewrite rewriteMs равен 0", async () => {
    const { options } = setup({ mode: "rewrite-filter" });
    const { timings } = await answerWithRag(options);
    for (const value of Object.values(timings)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it("filter: пустой отбор — модель не вызывается, ответ «не знаю» по порогу с ближайшими кандидатами", async () => {
    const { options, requests, kinds } = setup({ mode: "filter", threshold: 0.99 });
    const result = await answerWithRag(options);
    expect(result.hits).toEqual([]);
    expect(result.contextChars).toBe(0);
    expect(kinds).toEqual([]);
    expect(requests).toHaveLength(0);
    expect(result.answer).toEqual({ kind: "unknown", by: "retrieval", threshold: 0.99, nearest: CANDIDATES });
  });

  it("rewrite-filter: пустой отбор не отменяет rewrite, но генерации нет", async () => {
    const { options, kinds } = setup({ mode: "rewrite-filter", threshold: 0.99 });
    const result = await answerWithRag(options);
    expect(kinds).toEqual(["rewrite"]);
    expect(result.answer).toMatchObject({ kind: "unknown", by: "retrieval", threshold: 0.99 });
  });

  it("baseline: порог не применяется, отказ возможен только при пустом поиске и без порога в тексте", async () => {
    const full = setup({ mode: "baseline", threshold: 0.99 });
    await answerWithRag(full.options);
    expect(full.kinds).toEqual(["answer"]);
    const empty = setup({ mode: "baseline", index: fakeSearchIndex(() => []).index });
    const result = await answerWithRag(empty.options);
    expect(empty.kinds).toEqual([]);
    expect(result.answer).toEqual({ kind: "unknown", by: "retrieval", threshold: null, nearest: [] });
  });

  it("ответ модели в заданном формате разбирается без замечаний", async () => {
    const quote = "Первый фрагмент содержит достаточно длинный текст";
    const hits = [searchHit(1, "a.md", 0.9, `${quote} для цитаты.`)];
    const answer = () => `## Ответ\n\nТак [1].\n\n## Источники\n\n- [1]\n\n## Цитаты\n\n- [1] «${quote}»`;
    const { options } = setup({ index: fakeSearchIndex(() => hits).index }, { answer });
    const result = await answerWithRag(options);
    expect(result.answer).toMatchObject({ kind: "answer", text: "Так [1].", problems: [] });
  });

  it("считает размер сообщения в кодовых точках, а не в единицах UTF-16", async () => {
    const base = searchHit(1, "a.md", 0.9);
    const emoji: SearchHit = { ...base, chunk: { ...base.chunk, text: "😀" } };
    const { index } = fakeSearchIndex(() => [emoji]);
    const { options } = setup({ index, question: "Q" });
    const result = await answerWithRag(options);
    const message = renderRagMessage("Q", [emoji]);
    expect(message.length).toBeGreaterThan([...message].length);
    expect(result.contextChars).toBe([...message].length);
  });

  it("пустой вопрос отклоняется до rewrite и поиска", async () => {
    const { options, search, requests } = setup({ question: "   ", mode: "rewrite-filter" });
    const call = answerWithRag(options);
    await expect(call).rejects.toBeInstanceOf(AgentError);
    await expect(call).rejects.toMatchObject({ code: "EMPTY_INPUT" });
    expect(search).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });

  it("несогласованные параметры отклоняются до rewrite, поиска и генерации", async () => {
    const { options, search, requests } = setup({ mode: "rewrite-filter", candidateTopK: 2, topK: 5 });
    await expect(answerWithRag(options)).rejects.toMatchObject({
      code: "INVALID_RETRIEVAL_PARAMS",
      data: { reason: "order" },
    });
    expect(search).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });

  it("ошибка rewrite не запускает поиск и генерацию", async () => {
    const { options, search, kinds } = setup({ mode: "rewrite" }, { rewrite: () => "две\nстроки" });
    await expect(answerWithRag(options)).rejects.toMatchObject({ code: "REWRITE_INVALID" });
    expect(search).not.toHaveBeenCalled();
    expect(kinds).toEqual(["rewrite"]);
  });

  it("сбой модели при rewrite не подменяется исходным вопросом", async () => {
    const { options, search, kinds } = setup({ mode: "rewrite-filter" }, { failOn: { kind: "rewrite", call: 1 } });
    await expect(answerWithRag(options)).rejects.toThrow("сбой модели");
    expect(search).not.toHaveBeenCalled();
    expect(kinds).toEqual(["rewrite"]);
  });
});

describe("generateAnswer", () => {
  it("отвечает по готовым hits с исходным вопросом; принимает модель и hits, поиск ему недоступен", async () => {
    const { model, requests } = fakeModel();
    const selection = { hits: CANDIDATES, belowThreshold: [], overLimit: [] };
    const result = await generateAnswer({
      model,
      systemPrompt: "S",
      answerPrompt: "default",
      question: "Исходный вопрос",
      selection,
      threshold: null,
    });
    const message = renderRagMessage("Исходный вопрос", CANDIDATES);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.messages[1]?.content).toBe(message);
    expect(result.contextChars).toBe([...message].length);
  });
});

describe("шаблоны ответа", () => {
  it.each(ANSWER_PROMPTS)("%s: файл содержит все заголовки, которые разбирает citations.ts", (name) => {
    const text = readPrompt(ANSWER_PROMPT_FILES[name]);
    for (const heading of ["## Ответ", "## Источники", "## Цитаты", "## Не знаю", "## Уточнение"]) {
      expect(text).toContain(heading);
    }
  });
});
