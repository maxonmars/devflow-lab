import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelCompletion, ModelRequest, ToolSource } from "../../core/index.ts";
import { McpToolSourceError, type StdioToolSourceOptions } from "../../features/mcp/index.ts";
import type { WithToolSource } from "../toolSources.ts";
import { invoke } from "./harness.ts";

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "devflow-lab-ask-"));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const server = (serverName: string): StdioToolSourceOptions => ({
  command: "node",
  args: [`${serverName}.js`],
  serverName,
  timeoutMs: 1000,
});

/** Сессия-подмена: журнал открытий и закрытий, один инструмент `<сервер>_branch`. */
function fakeSessions(log: string[], result = { content: "main", isError: false }): WithToolSource {
  return async (options, use) => {
    log.push(`open ${options.serverName}`);
    const source: ToolSource = {
      listTools: async () => [{ name: `${options.serverName}_branch`, inputSchema: { type: "object" } }],
      callTool: async (invocation) => {
        log.push(`call ${invocation.name}`);
        return result;
      },
    };
    try {
      return await use(source);
    } finally {
      log.push(`close ${options.serverName}`);
    }
  };
}

/** Первый ответ модели — вызов инструмента, второй — текст с результатом инструмента. */
const toolThenText = (tool: string) =>
  vi.fn(async (request: ModelRequest): Promise<ModelCompletion> => {
    const last = request.messages.at(-1);
    if (last?.role === "tool") return { type: "text", content: `Ветка: ${last.content}` };
    return { type: "tool_calls", calls: [{ id: "c1", name: tool, arguments: {} }] };
  });

describe("ask с MCP-серверами", () => {
  it("открывает сессию на реплику, отдаёт модели инструменты и печатает строку вызова", async () => {
    const log: string[] = [];
    const complete = toolThenText("git_branch");
    const result = await invoke(["ask", "Какая ветка?"], {
      cwd,
      complete,
      mcpServers: () => [server("git")],
      withToolSource: fakeSessions(log),
    });
    expect(result.code).toBe(0);
    expect(log).toEqual(["open git", "call git_branch", "close git"]);
    const first = complete.mock.calls[0]?.[0] as ModelRequest;
    expect(first.tools.map((tool) => tool.name)).toEqual(["git_branch"]);
    expect(first.toolChoice).toBe("auto");
    expect(result.output).toContain("MCP: git › git_branch — выполнено");
    expect(result.output).toContain("Ветка: main");
  });

  it("несколько серверов открываются вложенно и закрываются в обратном порядке", async () => {
    const log: string[] = [];
    const result = await invoke(["ask", "Вопрос"], {
      cwd,
      complete: toolThenText("docs_branch"),
      mcpServers: () => [server("git"), server("docs")],
      withToolSource: fakeSessions(log),
    });
    expect(result.code).toBe(0);
    expect(log).toEqual(["open git", "open docs", "call docs_branch", "close docs", "close git"]);
  });

  it("результат инструмента с isError отмечается как ошибка, ответ всё равно приходит", async () => {
    const result = await invoke(["ask", "Вопрос"], {
      cwd,
      complete: toolThenText("git_branch"),
      mcpServers: () => [server("git")],
      withToolSource: fakeSessions([], { content: "не git-репозиторий", isError: true }),
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain("MCP: git › git_branch — ошибка");
  });

  it("ошибка запуска сервера показывается по-русски с именем сервера", async () => {
    const failing: WithToolSource = async (options) => {
      throw new McpToolSourceError("SERVER_START_FAILED", { server: options.serverName });
    };
    const result = await invoke(["ask", "Вопрос"], { cwd, mcpServers: () => [server("git")], withToolSource: failing });
    expect(result.code).toBe(1);
    expect(result.error).toBe("Ошибка · Не удалось запустить MCP-сервер «git».\n");
  });

  it("без ключа модели MCP-сервер не запускается", async () => {
    const log: string[] = [];
    const result = await invoke(["ask", "Вопрос"], {
      cwd,
      authenticated: false,
      mcpServers: () => [server("git")],
      withToolSource: fakeSessions(log),
    });
    expect(result.code).toBe(1);
    expect(log).toEqual([]);
  });
});
