import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelCompletion, ModelRequest, ToolResult, ToolSource } from "../../core/index.ts";
import type { StdioToolSourceOptions } from "../../features/mcp/index.ts";
import { MAX_REVIEW_CONTEXT_CHARS, MAX_REVIEW_FILES, parseChangedFiles } from "../review.ts";
import type { WithToolSource } from "../toolSources.ts";
import { invoke, keywordEmbeddings, writeCorpus } from "./harness.ts";

const GIT: StdioToolSourceOptions = { command: "node", args: ["git.js"], serverName: "git", timeoutMs: 1000 };
const VOCABULARY = ["серверы", "погода"];
const ANSWER =
  "## Потенциальные баги\n- src/a.ts:1 — ошибка.\n## Архитектурные проблемы\nНе найдено.\n## Рекомендации\nНе найдено.";
const ok = (content: string): ToolResult => ({ content, isError: false });

let cwd: string;
beforeEach(async () => {
  cwd = mkdtempSync(join(tmpdir(), "devflow-lab-review-"));
  writeCorpus(join(cwd, "docs"), {
    "servers.md": "# Серверы\n\nMCP-серверы только читают.",
    "other.md": "# Другое\n\nпогода",
  });
  await invoke(["rag", "index"], { cwd, embeddings: keywordEmbeddings(VOCABULARY) });
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

type Answers = Readonly<{
  changed: ToolResult;
  diff?: (path: string) => ToolResult;
  read?: (path: string) => ToolResult;
}>;

/** Подменённая сессия git-сервера: отвечает на три инструмента ревью и пишет вызовы в `log`. */
function gitSession(answers: Answers, log: string[]): WithToolSource {
  const tools = ["git_changed_files", "git_diff", "read_file"].map((name) => ({
    name,
    inputSchema: { type: "object" },
  }));
  return async (options, use) => {
    log.push(`open ${options.serverName}`);
    const source: ToolSource = {
      listTools: async () => tools,
      callTool: async ({ name, arguments: args }) => {
        log.push(`${name} ${String(args.path ?? args.base)}`);
        if (name === "git_changed_files") return answers.changed;
        const path = String(args.path);
        if (name === "git_diff") return answers.diff?.(path) ?? ok(`Изменения ${path}: серверы`);
        return answers.read?.(path) ?? ok(`Файл ${path} в HEAD: содержимое`);
      },
    };
    try {
      return await use(source);
    } finally {
      log.push(`close ${options.serverName}`);
    }
  };
}

const model = () =>
  vi.fn(async (_request: ModelRequest): Promise<ModelCompletion> => ({ type: "text", content: ANSWER }));

const run = (argv: string[], answers: Answers, log: string[] = [], complete = model()) =>
  invoke(argv, {
    cwd,
    complete,
    embeddings: keywordEmbeddings(VOCABULARY),
    mcpServers: () => [GIT],
    withToolSource: gitSession(answers, log),
  });

describe("review", () => {
  it("модель получает diff, содержимое и документацию; ревью печатается и пишется в файл", async () => {
    const log: string[] = [];
    const complete = model();
    const changed = ok("Изменённые файлы относительно main (2):\nM src/a.ts\nD docs/old.md");
    const result = await run(
      ["--review-output-file", ".local/review.md", "review", "main"],
      { changed },
      log,
      complete,
    );
    expect(result.error).toBe("");
    expect(log).toEqual([
      "open git",
      "git_changed_files main",
      "git_diff src/a.ts",
      "read_file src/a.ts",
      "git_diff docs/old.md",
      "close git",
    ]);
    expect(complete).toHaveBeenCalledTimes(1);
    const message = String(complete.mock.calls[0]?.[0].messages[1]?.content);
    for (const part of ["### M src/a.ts", "Изменения src/a.ts: серверы", "Файл src/a.ts в HEAD", "docs/servers.md"]) {
      expect(message).toContain(part);
    }
    expect(message).not.toContain("docs/other.md");
    expect(result.output).toContain("── AI-ревью · deepseek · deepseek-flash ──");
    expect(result.output).toContain("MCP: git › git_changed_files — выполнено");
    expect(result.output).toContain("### Потенциальные баги");
    expect(result.output).toContain("  1. docs/servers.md › Серверы");
    const saved = readFileSync(join(cwd, ".local/review.md"), "utf8");
    expect(saved.startsWith("## AI-ревью\n\n### Потенциальные баги")).toBe(true);
    expect(result.output).toContain(saved.trimEnd());
  });

  it("без изменений модель не вызывается", async () => {
    const complete = model();
    const result = await run(
      ["review", "main"],
      { changed: ok("Изменённых файлов относительно main нет.") },
      [],
      complete,
    );
    expect(result.code).toBe(0);
    expect(result.output).toContain("Изменений относительно main нет.");
    expect(complete).not.toHaveBeenCalled();
  });

  it("ошибка git_changed_files — код 1 и текст сервера, модель не вызывается", async () => {
    const complete = model();
    const changed = { content: "Ref базы не найден в репозитории.", isError: true };
    const result = await run(["review", "no-such-ref"], { changed }, [], complete);
    expect(result.code).toBe(1);
    expect(result.error).toBe("Ошибка · Ref базы не найден в репозитории.\n");
    expect(complete).not.toHaveBeenCalled();
  });

  it("лимиты файлов и бюджета: пропуски перечислены, содержимое сверх бюджета не добавляется", async () => {
    const log: string[] = [];
    const complete = model();
    const paths = Array.from({ length: MAX_REVIEW_FILES + 2 }, (_, i) => `f${i}.ts`);
    const changed = ok(
      `Изменённые файлы относительно main (${paths.length}):\n${paths.map((p) => `M ${p}`).join("\n")}`,
    );
    const result = await run(
      ["review", "main"],
      {
        changed,
        diff: (path) => ok(path === "f0.ts" ? "x".repeat(MAX_REVIEW_CONTEXT_CHARS + 1) : `diff ${path}`),
        read: (path) => ok(path === "f1.ts" ? "y".repeat(MAX_REVIEW_CONTEXT_CHARS) : `content ${path}`),
      },
      log,
      complete,
    );
    const message = String(complete.mock.calls[0]?.[0].messages[1]?.content);
    expect(message).toContain(
      `## Не вошло в контекст\n\n- f0.ts\n- f${MAX_REVIEW_FILES}.ts\n- f${MAX_REVIEW_FILES + 1}.ts`,
    );
    expect(message).toContain("diff f1.ts");
    expect(message).not.toContain("yyyy");
    expect(message).toContain("content f2.ts");
    expect(log).not.toContain(`git_diff f${MAX_REVIEW_FILES}.ts`);
    expect(result.output).toContain(`- Файлов в контексте: ${MAX_REVIEW_FILES - 1}`);
  });

  it("файл ревью не записан — ошибка с причиной; без git-инструментов — ошибка до вызова модели", async () => {
    writeCorpus(cwd, { "blocker.md": "файл вместо каталога" });
    const changed = ok("Изменённые файлы относительно main (1):\nM src/a.ts");
    const blocked = await run(["--review-output-file", "blocker.md/review.md", "review", "main"], { changed });
    expect(blocked.code).toBe(1);
    expect(blocked.error).toBe("Ошибка · Не удалось записать файл ревью.\n");
    const complete = model();
    const noTools = await invoke(["review", "main"], { cwd, complete, embeddings: keywordEmbeddings(VOCABULARY) });
    expect(noTools.error).toBe("Ошибка · MCP-серверы не объявили git-инструменты ревью.\n");
    expect(complete).not.toHaveBeenCalled();
  });

  it("без базы называет, чего не хватает", async () => {
    const result = await run(["review"], { changed: ok("") });
    expect(result.error).toBe("Ошибка · Не указана базовая ветка или коммит для ревью.\n");
  });

  it("без ключа git-сервер не запускается", async () => {
    const log: string[] = [];
    const result = await invoke(["review", "main"], {
      cwd,
      authenticated: false,
      mcpServers: () => [GIT],
      withToolSource: gitSession({ changed: ok("") }, log),
    });
    expect(result.code).toBe(1);
    expect(result.error).toContain("LAB_LLM_API_KEY");
    expect(log).toEqual([]);
  });
});

describe("parseChangedFiles", () => {
  it("разбирает R со старым путём и пропускает строку обрезки", () => {
    const text = "Изменённые файлы относительно main (3):\nA a.ts\nR new.ts ← old.ts\nПоказано 2 из 3.";
    expect(parseChangedFiles(text)).toEqual([
      { status: "A", path: "a.ts" },
      { status: "R", path: "new.ts", from: "old.ts" },
    ]);
  });

  it("неожиданный формат — ошибка, а не пустой список", () => {
    expect(() => parseChangedFiles("Что-то другое")).toThrow("Неожиданный формат списка изменённых файлов");
    expect(() => parseChangedFiles("Изменённые файлы относительно main (1):\nплохая строка")).toThrow();
  });
});
