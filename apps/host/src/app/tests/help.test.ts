import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelCompletion, ModelRequest, ToolSource } from "../../core/index.ts";
import type { StdioToolSourceOptions } from "../../features/mcp/index.ts";
import type { WithToolSource } from "../toolSources.ts";
import { fakeEmbeddings, invoke, keywordEmbeddings, writeCorpus } from "./harness.ts";

const GIT: StdioToolSourceOptions = { command: "node", args: ["git.js"], serverName: "git", timeoutMs: 1000 };
const QUOTE = "MCP-серверы лежат в каталоге servers и только читают проект";

let cwd: string;
beforeEach(async () => {
  cwd = mkdtempSync(join(tmpdir(), "devflow-lab-help-"));
  writeCorpus(join(cwd, "docs"), { "servers.md": `# Серверы\n\n${QUOTE}.`, "other.md": "# Другое\n\nпро погоду" });
  await invoke(["rag", "index"], { cwd, embeddings: keywordEmbeddings(["серверы", "ветка"]) });
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function gitSession(log: string[]): WithToolSource {
  return async (options, use) => {
    log.push(`open ${options.serverName}`);
    const source: ToolSource = {
      listTools: async () => [{ name: "git_branch", inputSchema: { type: "object" } }],
      callTool: async () => ({ content: "Ветка: day-1", isError: false }),
    };
    try {
      return await use(source);
    } finally {
      log.push(`close ${options.serverName}`);
    }
  };
}

/** Rewrite возвращает вопрос; ответ сначала вызывает git_branch, затем пишет разделы с данными проекта. */
const assistant = () =>
  vi.fn(async (request: ModelRequest): Promise<ModelCompletion> => {
    if (String(request.messages[0]?.content).includes("переписываешь")) {
      return { type: "text", content: String(request.messages[1]?.content) };
    }
    if (!request.messages.some((message) => message.role === "tool")) {
      return { type: "tool_calls", calls: [{ id: "c1", name: "git_branch", arguments: {} }] };
    }
    const answer = `## Ответ\nВетка day-1, серверы — в servers [1].\n## Источники\n- [1]\n## Цитаты\n- [1] «${QUOTE}»\n## Данные проекта\n- git_branch: ветка day-1`;
    return { type: "text", content: answer };
  });

const run = (argv: string[], log: string[], complete = assistant(), input?: string) =>
  invoke(argv, {
    cwd,
    complete,
    embeddings: keywordEmbeddings(["серверы", "ветка"]),
    mcpServers: () => [GIT],
    withToolSource: gitSession(log),
    ...(input === undefined ? {} : { input }),
  });

describe("help с вопросом", () => {
  it("ассистент получает фрагменты и git-инструменты, ответ показывает цитату и данные проекта", async () => {
    const log: string[] = [];
    const complete = assistant();
    const result = await run(["help", "Где", "серверы", "и", "какая", "ветка?"], log, complete);
    expect(result.error).toBe("");
    expect(log).toEqual(["open git", "close git"]);
    const answering = complete.mock.calls.map(([request]) => request).find((request) => request.tools.length > 0);
    expect(answering?.tools.map((tool) => tool.name)).toEqual(["git_branch"]);
    expect(String(answering?.messages[1]?.content)).toContain("docs/servers.md");
    expect(result.output).toContain("── Ответ ассистента проекта · deepseek · deepseek-flash ──");
    expect(result.output).toContain("MCP: git › git_branch — выполнено");
    expect(result.output).toContain("Данные проекта:\n- git_branch: ветка day-1");
    expect(result.output).toContain("— найдена во фрагменте 1");
    expect(result.output).not.toContain("Замечания");
  });

  it("REPL: /help с вопросом отвечает, /help без вопроса печатает справку", async () => {
    const result = await run([], [], assistant(), "/help какая ветка?\n/help\n/exit\n");
    expect(result.output).toContain("Ответ ассистента проекта");
    expect(result.output).toContain("── Справка ──");
  });

  it("без аргументов и через --help — прежняя справка без модели и MCP", async () => {
    for (const argv of [["help"], ["--help"], ["-h"]]) {
      const log: string[] = [];
      const result = await run(argv, log);
      expect(result.output).toContain("help [вопрос...]");
      expect(result.createModel).not.toHaveBeenCalled();
      expect(log).toEqual([]);
    }
  });

  it("без ключа и без индекса git-сервер не запускается, ошибка называет причину", async () => {
    const log: string[] = [];
    const noKey = await invoke(["help", "Какая ветка?"], {
      cwd,
      authenticated: false,
      mcpServers: () => [GIT],
      withToolSource: gitSession(log),
    });
    expect(noKey.code).toBe(1);
    expect(noKey.error).toContain("LAB_LLM_API_KEY");
    const empty = mkdtempSync(join(tmpdir(), "devflow-lab-help-empty-"));
    try {
      const noIndex = await invoke(["help", "Какая ветка?"], {
        cwd: empty,
        embeddings: fakeEmbeddings(),
        mcpServers: () => [GIT],
        withToolSource: gitSession(log),
      });
      expect(noIndex.error).toContain("rag index");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
    expect(log).toEqual([]);
  });
});
