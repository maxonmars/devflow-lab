import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseOptions, resolveConfig, showConfig } from "../config.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "devflow-lab-config-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("конфигурация", () => {
  it("применяет defaults < файл < env < CLI и сохраняет источники", () => {
    writeFileSync(join(root, "lab.config.yaml"), "llm.model: file-model\nllm.timeoutMs: 10\n");
    const config = resolveConfig({ "llm.model": "cli-model" }, { LAB_LLM_MODEL: "env-model" }, root);
    expect(config.values["llm.model"]).toBe("cli-model");
    expect(config.sources["llm.model"]).toBe("cli");
    expect(config.values["llm.timeoutMs"]).toBe(10);
    expect(config.sources["llm.timeoutMs"]).toBe("file");
    expect(config.sources["llm.maxOutputTokens"]).toBe("default");
    expect(resolveConfig({}, { LAB_LLM_MODEL: "env-model" }, root).sources["llm.model"]).toBe("env");
  });

  it("применяет приоритет источников для настроек проекта и RAG", () => {
    writeFileSync(join(root, "lab.config.yaml"), "project.root: file-dir\nrag.chunkSizeChars: 20\n");
    const config = resolveConfig(
      { "project.root": "cli-dir", "rag.chunkSizeChars": "40" },
      { LAB_PROJECT_ROOT: "env-dir", LAB_RAG_CHUNK_SIZE_CHARS: "30" },
      root,
    );
    expect(config.values["project.root"]).toBe("cli-dir");
    expect(config.values["rag.chunkSizeChars"]).toBe(40);
    expect(config.sources["project.root"]).toBe("cli");
    expect(resolveConfig({}, {}, root).sources["project.root"]).toBe("file");
    const envOnly = resolveConfig({}, { LAB_PROJECT_ROOT: "env-dir", LAB_RAG_CHUNK_SIZE_CHARS: "30" }, root);
    expect(envOnly.values["project.root"]).toBe("env-dir");
    expect(envOnly.values["rag.chunkSizeChars"]).toBe(30);
    expect(envOnly.sources["rag.chunkSizeChars"]).toBe("env");
  });

  it("не выводит секрет и не принимает его из файла или CLI", () => {
    const config = resolveConfig({}, { LAB_LLM_API_KEY: "sensitive" }, root);
    const rows = showConfig(config);
    expect(rows).toContainEqual({ key: "llm.apiKey", value: "[задано]", source: "env" });
    expect(JSON.stringify(rows)).not.toContain("sensitive");
    expect(showConfig(resolveConfig({}, {}, root))).toContainEqual({
      key: "llm.apiKey",
      value: "[не задано]",
      source: "default",
    });
    expect(() => parseOptions(["--llm-api-key", "sensitive"])).toThrow();
    expect(() => resolveConfig({ "llm.apiKey": "sensitive" }, {}, root)).toThrow();
    writeFileSync(join(root, "lab.config.yaml"), "llm.apiKey: sensitive");
    expect(() => resolveConfig({}, {}, root)).toThrow(/недоступная настройка/);
  });

  it("llm.localApiKey: показывает только [задано]/[не задано], не принимает из файла и CLI", () => {
    const config = resolveConfig({}, { LAB_LLM_LOCAL_API_KEY: "gateway-secret" }, root);
    const rows = showConfig(config);
    expect(rows).toContainEqual({ key: "llm.localApiKey", value: "[задано]", source: "env" });
    expect(JSON.stringify(rows)).not.toContain("gateway-secret");
    expect(showConfig(resolveConfig({}, {}, root))).toContainEqual({
      key: "llm.localApiKey",
      value: "[не задано]",
      source: "default",
    });
    expect(() => parseOptions(["--llm-local-api-key", "gateway-secret"])).toThrow();
    writeFileSync(join(root, "lab.config.yaml"), "llm.localApiKey: gateway-secret");
    expect(() => resolveConfig({}, {}, root)).toThrow(/недоступная настройка/);
  });

  it("отклоняет некорректный источник даже при наличии переопределения", () => {
    writeFileSync(join(root, "lab.config.yaml"), "llm.timeoutMs: -1");
    expect(() => resolveConfig({ "llm.timeoutMs": "20" }, {}, root)).toThrow(/источник: file/);
  });

  it("отклоняет пустой путь, нулевой размер чанка и некорректный адрес Ollama", () => {
    expect(() => resolveConfig({ "project.root": " " }, {}, root)).toThrow(/project.root/);
    expect(() => resolveConfig({ "rag.chunkSizeChars": "0" }, {}, root)).toThrow(/rag.chunkSizeChars/);
    expect(() => resolveConfig({ "rag.embeddingBaseUrl": "не адрес" }, {}, root)).toThrow(/rag.embeddingBaseUrl/);
    writeFileSync(join(root, "lab.config.yaml"), 'project.root: " "\n');
    expect(() => resolveConfig({ "project.root": "valid" }, {}, root)).toThrow(/источник: file/);
  });

  it("настройки поиска: defaults, приоритет файл < env < CLI, числа из строк", () => {
    const defaults = resolveConfig({}, {}, root).values;
    expect([defaults["rag.retrievalMode"], defaults["rag.candidateTopK"], defaults["rag.topK"]]).toEqual([
      "rewrite-filter",
      10,
      5,
    ]);
    expect(defaults["rag.similarityThreshold"]).toBe(0.55);
    writeFileSync(
      join(root, "lab.config.yaml"),
      "rag.retrievalMode: baseline\nrag.candidateTopK: 12\nrag.similarityThreshold: 0.6\n",
    );
    const file = resolveConfig({}, {}, root);
    expect([
      file.values["rag.retrievalMode"],
      file.values["rag.candidateTopK"],
      file.values["rag.similarityThreshold"],
    ]).toEqual(["baseline", 12, 0.6]);
    expect(file.sources["rag.candidateTopK"]).toBe("file");
    const env = {
      LAB_RAG_RETRIEVAL_MODE: "filter",
      LAB_RAG_CANDIDATE_TOP_K: "8",
      LAB_RAG_SIMILARITY_THRESHOLD: "-0.25",
    };
    const fromEnv = resolveConfig({}, env, root);
    expect([
      fromEnv.values["rag.retrievalMode"],
      fromEnv.values["rag.candidateTopK"],
      fromEnv.values["rag.similarityThreshold"],
    ]).toEqual(["filter", 8, -0.25]);
    expect(fromEnv.sources["rag.similarityThreshold"]).toBe("env");
    const flags = { "rag.retrievalMode": "rewrite", "rag.candidateTopK": "6", "rag.similarityThreshold": "0.7" };
    const cli = resolveConfig(flags, env, root);
    expect([
      cli.values["rag.retrievalMode"],
      cli.values["rag.candidateTopK"],
      cli.values["rag.similarityThreshold"],
    ]).toEqual(["rewrite", 6, 0.7]);
    expect(cli.sources["rag.retrievalMode"]).toBe("cli");
  });

  it("rag.include: список через запятую из любого источника, пути вне корня отклоняются", () => {
    expect(resolveConfig({}, {}, root).values["rag.include"]).toContain("docs/**/*.md");
    const cli = resolveConfig({ "rag.include": " README.md, docs/*.md ,," }, {}, root);
    expect(cli.values["rag.include"]).toEqual(["README.md", "docs/*.md"]);
    expect(showConfig(cli).find((row) => row.key === "rag.include")?.value).toBe("README.md,docs/*.md");
    writeFileSync(join(root, "lab.config.yaml"), "rag.include: AGENTS.md\n");
    expect(resolveConfig({}, {}, root).values["rag.include"]).toEqual(["AGENTS.md"]);
    expect(resolveConfig({}, { LAB_RAG_INCLUDE: "a.md,b.md" }, root).values["rag.include"]).toEqual(["a.md", "b.md"]);
    for (const value of ["/etc/*.md", "../rag-lab/*.md", "docs/../../x.md", " , "]) {
      expect(() => resolveConfig({ "rag.include": value }, {}, root)).toThrow(/rag.include \(источник: cli\)/);
    }
  });

  it("mcp.timeoutMs: по умолчанию 10000, env переопределяет, не число отклоняется", () => {
    expect(resolveConfig({}, {}, root).values["mcp.timeoutMs"]).toBe(10000);
    expect(resolveConfig({}, { LAB_MCP_TIMEOUT_MS: "2500" }, root).values["mcp.timeoutMs"]).toBe(2500);
    expect(() => resolveConfig({ "mcp.timeoutMs": "fast" }, {}, root)).toThrow(/mcp.timeoutMs/);
  });

  it("rag.answerPrompt: по умолчанию default, флаг и значение compact принимаются", () => {
    expect(resolveConfig({}, {}, root).values["rag.answerPrompt"]).toBe("default");
    expect(parseOptions(["--rag-answer-prompt=compact"]).flags).toEqual({ "rag.answerPrompt": "compact" });
    expect(resolveConfig({ "rag.answerPrompt": "compact" }, {}, root).values["rag.answerPrompt"]).toBe("compact");
  });

  it.each([
    ["rag.answerPrompt", "foo"],
    ["rag.retrievalMode", "hybrid"],
    ["rag.retrievalMode", ""],
    ["rag.candidateTopK", "0"],
    ["rag.candidateTopK", "21"],
    ["rag.candidateTopK", "2.5"],
    ["rag.topK", "1.5"],
    ["rag.similarityThreshold", "1.01"],
    ["rag.similarityThreshold", "-1.01"],
    ["rag.similarityThreshold", "abc"],
    ["rag.similarityThreshold", "Infinity"],
  ])("отклоняет %s=%j", (key, value) => {
    expect(() => resolveConfig({ [key]: value }, {}, root)).toThrow(
      new RegExp(`${key.replace(".", "\\.")}.*источник: cli`),
    );
  });

  it("принимает граничные пороги -1 и 1 и выводит флаги из ключей", () => {
    expect(resolveConfig({ "rag.similarityThreshold": "-1" }, {}, root).values["rag.similarityThreshold"]).toBe(-1);
    expect(resolveConfig({ "rag.similarityThreshold": "1" }, {}, root).values["rag.similarityThreshold"]).toBe(1);
    expect(
      parseOptions(["--rag-retrieval-mode=filter", "--rag-candidate-top-k", "12", "--rag-similarity-threshold=0.5"])
        .flags,
    ).toEqual({
      "rag.retrievalMode": "filter",
      "rag.candidateTopK": "12",
      "rag.similarityThreshold": "0.5",
    });
  });

  it("допускает нулевое перекрытие", () => {
    expect(resolveConfig({ "rag.overlapChars": "0" }, {}, root).values["rag.overlapChars"]).toBe(0);
  });

  it.each(["llm.model: [x]", "unknown: value", "- list", "llm.model: ["])("отклоняет файл %s", (text) => {
    writeFileSync(join(root, "lab.config.yaml"), text);
    expect(() => resolveConfig({}, {}, root)).toThrow();
  });

  it("различает отсутствующий default-файл и явно указанный путь", () => {
    const config = resolveConfig({}, {}, root);
    expect(config.values["llm.model"]).toBe("deepseek-flash");
    expect(config.values["project.root"]).toBe(".");
    expect(config.values["rag.embeddingModel"]).toBe("bge-m3");
    expect(() => resolveConfig({ "config.file": "missing.yaml" }, {}, root)).toThrow(/прочитать/);
  });

  it("разбирает флаги из реестра и сохраняет текст после --", () => {
    expect(parseOptions(["--llm-model=other", "ask", "--", "--literal"])).toEqual({
      flags: { "llm.model": "other" },
      command: ["ask", "--literal"],
    });
    for (const argv of [["--unknown", "x"], ["--llm-model"], ["--llm-model=x", "--llm-model=y"]]) {
      expect(() => parseOptions(argv)).toThrow();
    }
    expect(parseOptions(["--project-root", "folder", "--rag-chunk-size-chars=12", "rag", "index"])).toEqual({
      flags: { "project.root": "folder", "rag.chunkSizeChars": "12" },
      command: ["rag", "index"],
    });
  });
});
