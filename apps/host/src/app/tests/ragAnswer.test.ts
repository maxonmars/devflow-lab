import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModelRequest } from "../../core/index.ts";
import { fakeEmbeddings, invoke, writeCorpus } from "./harness.ts";

let cwd: string;
beforeEach(async () => {
  cwd = mkdtempSync(join(tmpdir(), "devflow-lab-answer-"));
  writeCorpus(join(cwd, "docs"), {
    "a.md": `# Один\n\n${"слово ".repeat(500)}\n\n## Раздел\n\ntext раздела`,
    "b.md": "# Два\n\nкороткий документ",
  });
  await invoke(["rag", "index"], { cwd, embeddings: fakeEmbeddings() });
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const requestOf = (result: { complete: { mock: { calls: unknown[][] } } }, call = 0) =>
  result.complete.mock.calls[call]?.[0] as ModelRequest;

describe("rag ask", () => {
  it("печатает ответ с фрагментами; модель получает system.md, инструкцию RAG и фрагменты с вопросом", async () => {
    const result = await invoke(["--rag-retrieval-mode=baseline", "rag", "ask", "Что такое короткий документ?"], {
      cwd,
      embeddings: fakeEmbeddings(),
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain("── Ответ агента · RAG · deepseek · deepseek-flash ──");
    expect(result.output).toContain("Фрагменты:");
    expect(result.output).toMatch(/\n {2}1\. docs\/[ab]\.md › /);
    const request = requestOf(result);
    expect(request.messages[0]?.content).toContain("ассистент разработчика проекта");
    expect(request.messages[0]?.content).toContain("фрагменты документации");
    const user = String(request.messages[1]?.content);
    expect(user).toContain("### Фрагмент 1");
    expect(user).toContain("короткий документ");
    expect(user.endsWith("## Вопрос\n\nЧто такое короткий документ?")).toBe(true);
    expect(request.tools).toEqual([]);
  });

  it("--rag-answer-prompt=compact: модель получает инструкцию answer-compact.md вместо answer.md", async () => {
    const compact = await invoke(
      ["--rag-retrieval-mode=baseline", "--rag-answer-prompt=compact", "rag", "ask", "Вопрос"],
      { cwd, embeddings: fakeEmbeddings() },
    );
    const standard = await invoke(["--rag-retrieval-mode=baseline", "rag", "ask", "Вопрос"], {
      cwd,
      embeddings: fakeEmbeddings(),
    });
    expect(compact.code).toBe(0);
    expect(requestOf(compact).messages[0]?.content).toContain("символ в символ");
    expect(requestOf(standard).messages[0]?.content).not.toContain("символ в символ");
  });

  it("--rag-top-k ограничивает число фрагментов", async () => {
    const baseline = "--rag-retrieval-mode=baseline";
    const one = await invoke([baseline, "--rag-top-k=1", "rag", "ask", "Вопрос"], {
      cwd,
      embeddings: fakeEmbeddings(),
    });
    const many = await invoke([baseline, "--rag-candidate-top-k=20", "--rag-top-k=20", "rag", "ask", "Вопрос"], {
      cwd,
      embeddings: fakeEmbeddings(),
    });
    expect(one.output.match(/^ {2}\d+\. /gm)).toHaveLength(1);
    expect(many.output.match(/^ {2}\d+\. /gm)?.length).toBeGreaterThan(1);
    expect(requestOf(one).messages[1]?.content).not.toContain("### Фрагмент 2");
  });

  it.each([
    ["--rag-top-k=0", "rag.topK"],
    ["--rag-top-k=21", "rag.topK"],
    ["--rag-top-k=1.5", "rag.topK"],
  ])("%s отклоняется до обращения к модели и Ollama", async (flag, key) => {
    const result = await invoke([flag, "rag", "ask", "Вопрос"], { cwd, embeddings: fakeEmbeddings() });
    expect(result.code).toBe(1);
    expect(result.error).toBe(`Ошибка · Некорректная настройка ${key} (источник: cli).\n`);
    expect(result.createModel).not.toHaveBeenCalled();
  });

  it("без индекса завершается кодом 1 с подсказкой rag index", async () => {
    const empty = mkdtempSync(join(tmpdir(), "devflow-lab-empty-"));
    try {
      const result = await invoke(["rag", "ask", "Вопрос"], { cwd: empty, embeddings: fakeEmbeddings() });
      expect(result.code).toBe(1);
      expect(result.error).toContain("rag index");
      expect(result.complete).not.toHaveBeenCalled();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("без ключа сообщает про LAB_LLM_API_KEY раньше, чем обращается к Ollama", async () => {
    const result = await invoke(["rag", "ask", "Вопрос"], { cwd, authenticated: false });
    expect(result.code).toBe(1);
    expect(result.error).toContain("LAB_LLM_API_KEY");
    expect(result.createEmbeddings).not.toHaveBeenCalled();
  });

  it("при другой модели эмбеддингов подсказывает пересобрать индекс", async () => {
    const other = fakeEmbeddings();
    other.describeModel = async () => ({ name: "other:latest", digest: "ffff" });
    const result = await invoke(["rag", "ask", "Вопрос"], { cwd, embeddings: other });
    expect(result.code).toBe(1);
    expect(result.error).toContain("Индекс построен моделью fake:latest, а для запроса выбрана other:latest");
  });
});
