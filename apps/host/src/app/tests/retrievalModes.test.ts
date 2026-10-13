import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelRequest } from "../../core/index.ts";
import { type CompleteMock, fakeEmbeddings, invoke, keywordEmbeddings, writeCorpus } from "./harness.ts";

const VOCABULARY = ["слово", "короткий"];
const embeddings = () => keywordEmbeddings(VOCABULARY);

/** Rewrite всегда возвращает «слово»: запрос «Вопрос» — нулевой вектор, «слово» — ровно чанки документа a.md. */
function scriptedModel(): CompleteMock {
  return vi.fn(async (request: ModelRequest) => ({
    type: "text" as const,
    content: String(request.messages[0]?.content).includes("переписываешь") ? "слово" : "ответ модели",
  }));
}

const fragments = (output: string) => output.match(/^ {2}\d+\. .*$/gm) ?? [];
const scoreOf = (line: string) => /· (-?\d\.\d\d)/.exec(line)?.[1];

let cwd: string;
beforeEach(async () => {
  cwd = mkdtempSync(join(tmpdir(), "devflow-lab-modes-"));
  writeCorpus(join(cwd, "docs"), {
    "a.md": `# Один\n\n${"слово ".repeat(500)}\n\n## Раздел\n\nтекст раздела`,
    "b.md": "# Два\n\nкороткий документ",
  });
  await invoke(["rag", "index"], { cwd, embeddings: embeddings() });
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("режимы поиска в rag ask", () => {
  it("по умолчанию rag.retrievalMode — rewrite-filter, а лимиты и порог — 10, 5 и 0.55", async () => {
    const config = await invoke(["config", "show"], { cwd, authenticated: false });
    expect(config.output).toMatch(/rag\.retrievalMode\s+rewrite-filter\s+\(default\)/);
    expect(config.output).toMatch(/rag\.candidateTopK\s+10\s+\(default\)/);
    expect(config.output).toMatch(/rag\.topK\s+5\s+\(default\)/);
    expect(config.output).toMatch(/rag\.similarityThreshold\s+0\.55\s+\(default\)/);
    const complete = scriptedModel();
    const result = await invoke(["rag", "ask", "Вопрос"], { cwd, embeddings: embeddings(), complete });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(result.output).toMatch(/^ {2}1\. docs\/a\.md › .* · 1\.00/m);
    expect(result.output).not.toContain("b.md");
  });

  it.each([
    ["baseline", 1],
    ["filter", 0],
    ["rewrite", 2],
    ["rewrite-filter", 2],
  ])("--rag-retrieval-mode=%s вызывает модель %i раз(а)", async (mode, calls) => {
    const complete = scriptedModel();
    const result = await invoke([`--rag-retrieval-mode=${mode}`, "rag", "ask", "Вопрос"], {
      cwd,
      embeddings: embeddings(),
      complete,
    });
    expect(result.code).toBe(0);
    expect(complete).toHaveBeenCalledTimes(calls);
    const answers = complete.mock.calls.filter(
      ([request]) => !String(request.messages[0]?.content).includes("переписываешь"),
    );
    for (const [request] of answers)
      expect(String(request.messages[1]?.content).endsWith("## Вопрос\n\nВопрос")).toBe(true);
  });

  it("baseline и rewrite не применяют порог, filter и rewrite-filter применяют", async () => {
    const shown = async (mode: string) => {
      const result = await invoke([`--rag-retrieval-mode=${mode}`, "rag", "ask", "Вопрос"], {
        cwd,
        embeddings: embeddings(),
        complete: scriptedModel(),
      });
      return fragments(result.output);
    };
    const baseline = await shown("baseline");
    const filter = await shown("filter");
    const rewrite = await shown("rewrite");
    const rewriteFilter = await shown("rewrite-filter");
    expect(baseline.length).toBeGreaterThan(1);
    expect(baseline.map(scoreOf)).toEqual(baseline.map(() => "0.00"));
    expect(filter).toEqual([]);
    expect(rewrite.length).toBe(baseline.length);
    expect(rewrite[0]).toMatch(/a\.md .* · 1\.00/);
    expect(rewriteFilter.length).toBeGreaterThan(0);
    expect(rewriteFilter.length).toBeLessThan(rewrite.length);
    expect(rewriteFilter.every((line) => line.includes("a.md") && scoreOf(line) === "1.00")).toBe(true);
  });

  it("пустой итоговый контекст: модель не вызывается, CLI пишет «не знаю» по порогу и «контекст пуст»", async () => {
    const complete = scriptedModel();
    const result = await invoke(["--rag-retrieval-mode=filter", "rag", "ask", "Вопрос"], {
      cwd,
      embeddings: embeddings(),
      complete,
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain("Не знаю: ни один фрагмент не достиг порога сходства 0.55");
    expect(result.output).toContain("Фрагменты: контекст пуст");
    expect(complete).not.toHaveBeenCalled();
  });

  it("ошибка формата rewrite показывается по-русски: поиск и ответ не выполняются", async () => {
    const complete: CompleteMock = vi.fn(async () => ({ type: "text" as const, content: "первая\nвторая" }));
    const result = await invoke(["rag", "ask", "Вопрос"], { cwd, embeddings: embeddings(), complete });
    expect(result.code).toBe(1);
    expect(result.error).toBe(
      "Ошибка · Модель вернула некорректный поисковый запрос: запрос занимает несколько строк.\n",
    );
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.output).toBe("");
  });
});

describe("настройки поиска через YAML, env и CLI", () => {
  const file = "rag.retrievalMode: filter\nrag.candidateTopK: 8\nrag.topK: 3\nrag.similarityThreshold: 0.9\n";

  it("config show показывает источник каждого значения: файл, env, CLI", async () => {
    writeFileSync(join(cwd, "lab.config.yaml"), file);
    const fromFile = await invoke(["config", "show"], { cwd });
    expect(fromFile.output).toMatch(/rag\.retrievalMode\s+filter\s+\(file\)/);
    expect(fromFile.output).toMatch(/rag\.candidateTopK\s+8\s+\(file\)/);
    expect(fromFile.output).toMatch(/rag\.similarityThreshold\s+0\.9\s+\(file\)/);
    const env = { LAB_RAG_SIMILARITY_THRESHOLD: "0.7", LAB_RAG_RETRIEVAL_MODE: "rewrite" };
    const fromEnv = await invoke(["config", "show"], { cwd, env });
    expect(fromEnv.output).toMatch(/rag\.similarityThreshold\s+0\.7\s+\(env\)/);
    expect(fromEnv.output).toMatch(/rag\.retrievalMode\s+rewrite\s+\(env\)/);
    const cli = await invoke(["--rag-similarity-threshold=0.6", "--rag-candidate-top-k", "9", "config", "show"], {
      cwd,
      env,
    });
    expect(cli.output).toMatch(/rag\.similarityThreshold\s+0\.6\s+\(cli\)/);
    expect(cli.output).toMatch(/rag\.candidateTopK\s+9\s+\(cli\)/);
    expect(cli.output).toMatch(/rag\.retrievalMode\s+rewrite\s+\(env\)/);
  });
});

describe("некорректные настройки поиска отклоняются до внешних вызовов", () => {
  it.each([
    ["--rag-retrieval-mode=hybrid", "rag.retrievalMode"],
    ["--rag-candidate-top-k=0", "rag.candidateTopK"],
    ["--rag-candidate-top-k=21", "rag.candidateTopK"],
    ["--rag-candidate-top-k=2.5", "rag.candidateTopK"],
    ["--rag-top-k=1.5", "rag.topK"],
    ["--rag-similarity-threshold=1.01", "rag.similarityThreshold"],
    ["--rag-similarity-threshold=-1.01", "rag.similarityThreshold"],
    ["--rag-similarity-threshold=высокий", "rag.similarityThreshold"],
  ])("%s", async (flag, key) => {
    const result = await invoke([flag, "rag", "ask", "Вопрос"], { cwd, embeddings: embeddings() });
    expect(result.code).toBe(1);
    expect(result.error).toBe(`Ошибка · Некорректная настройка ${key} (источник: cli).\n`);
    expect(result.createModel).not.toHaveBeenCalled();
    expect(result.createEmbeddings).not.toHaveBeenCalled();
  });

  it("неверное значение из env и из файла называет свой источник", async () => {
    const env = await invoke(["rag", "ask", "Вопрос"], { cwd, env: { LAB_RAG_CANDIDATE_TOP_K: "0" } });
    expect(env.error).toBe("Ошибка · Некорректная настройка rag.candidateTopK (источник: env).\n");
    writeFileSync(join(cwd, "lab.config.yaml"), "rag.similarityThreshold: 2\n");
    const file = await invoke(["rag", "ask", "Вопрос"], { cwd });
    expect(file.error).toBe("Ошибка · Некорректная настройка rag.similarityThreshold (источник: file).\n");
  });

  it.each([["rag ask", ["rag", "ask", "Вопрос"], undefined]])(
    "candidateTopK меньше topK: %s",
    async (_name, argv, input) => {
      const flags = ["--rag-candidate-top-k=3", "--rag-top-k=4"];
      const result = await invoke([...flags, ...argv], { cwd, input, embeddings: embeddings() });
      expect(result.code).toBe(1);
      expect(result.error).toBe("Ошибка · rag.topK не должен превышать rag.candidateTopK.\n");
      expect(result.createModel).not.toHaveBeenCalled();
      expect(result.createEmbeddings).not.toHaveBeenCalled();
    },
  );

  it("существующий флаг --rag-top-k ограничивает итоговые чанки без изменения candidateTopK", async () => {
    const result = await invoke(["--rag-top-k=1", "--rag-retrieval-mode=baseline", "rag", "ask", "Вопрос"], {
      cwd,
      embeddings: fakeEmbeddings(),
    });
    expect(fragments(result.output)).toHaveLength(1);
  });
});
