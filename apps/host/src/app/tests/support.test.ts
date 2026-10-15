import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelCompletion, ModelRequest, ToolResult, ToolSource } from "../../core/index.ts";
import type { WithToolSource } from "../toolSources.ts";
import { invoke, keywordEmbeddings, writeCorpus } from "./harness.ts";

const VOCABULARY = ["блокировк", "погода"];
const TICKET = "Тикет T-1001: Не могу войти\nСтатус аккаунта: временно заблокирован (locked)\nПишет: блокировка";
const ANSWER = "## Ответ\nВход закрыт на 30 минут [1].\n## Источники\n- [1]\n## Данные тикета\n- Статус: locked";
const ok = (content: string): ToolResult => ({ content, isError: false });

let cwd: string;
beforeEach(async () => {
  cwd = mkdtempSync(join(tmpdir(), "devflow-lab-support-"));
  writeCorpus(join(cwd, "docs"), {
    "auth.md": "# Вход\n\nБлокировка аккаунта на 30 минут.",
    "other.md": "# Другое\n\nпогода",
  });
  await invoke(["rag", "index"], { cwd, embeddings: keywordEmbeddings(VOCABULARY) });
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

/** Подменённая сессия сервера поддержки: пишет открытие, аргументы запуска и вызовы в `log`. */
function supportSession(ticket: ToolResult, log: string[], tools = ["get_ticket"]): WithToolSource {
  return async (options, use) => {
    log.push(`open ${options.serverName} ${options.args.slice(1).join(" ")}`);
    const source: ToolSource = {
      listTools: async () => tools.map((name) => ({ name, inputSchema: { type: "object" } })),
      callTool: async ({ name, arguments: args }) => {
        log.push(`${name} ${String(args.id)}`);
        return ticket;
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

const run = (argv: string[], ticket: ToolResult, log: string[] = [], complete = model(), tools?: string[]) =>
  invoke(argv, {
    cwd,
    complete,
    embeddings: keywordEmbeddings(VOCABULARY),
    withToolSource: supportSession(ticket, log, tools),
  });

describe("support", () => {
  it("тикет, документация и вопрос уходят модели одним вызовом; ответ печатается с контекстом", async () => {
    const log: string[] = [];
    const complete = model();
    const result = await run(["support", "T-1001", "Почему", "блокировка?"], ok(TICKET), log, complete);
    expect(result.error).toBe("");
    expect(log).toEqual([
      `open support --data ${join(cwd, "support/tickets.json")}`,
      "get_ticket T-1001",
      "close support",
    ]);
    expect(complete).toHaveBeenCalledTimes(1);
    const request = complete.mock.calls[0]?.[0];
    expect(request?.tools).toEqual([]);
    const system = readFileSync(new URL("../system.md", import.meta.url), "utf8").trim();
    expect(String(request?.messages[0]?.content)).not.toContain(system.split("\n")[0]);
    const message = String(request?.messages[1]?.content);
    for (const part of [TICKET, "docs/auth.md", "## Вопрос клиента\n\nПочему блокировка?"]) {
      expect(message).toContain(part);
    }
    expect(message).not.toContain("docs/other.md");
    expect(result.output).toContain("── Ответ поддержки · deepseek · deepseek-flash ──");
    expect(result.output).toContain("MCP: support › get_ticket — выполнено");
    expect(result.output).toContain("## Ответ поддержки по тикету T-1001\n\n### Ответ");
    expect(result.output).toContain("### Контекст ответа");
    expect(result.output).toContain("  1. docs/auth.md › Вход");
  });

  it("REPL: /support разбирает тикет и вопрос", async () => {
    const log: string[] = [];
    const result = await invoke([], {
      cwd,
      input: "/support T-1003 что делать с блокировкой?\n/exit\n",
      complete: model(),
      embeddings: keywordEmbeddings(VOCABULARY),
      withToolSource: supportSession(ok(TICKET), log),
    });
    expect(result.error).toBe("");
    expect(log).toContain("get_ticket T-1003");
    expect(result.output).toContain("- Вопрос: что делать с блокировкой?");
  });

  it("ошибка get_ticket — код 1 и текст сервера, модель не вызывается", async () => {
    const complete = model();
    const missing = { content: "Тикет с таким идентификатором не найден.", isError: true };
    const result = await run(["support", "T-9999", "Не могу войти"], missing, [], complete);
    expect(result.code).toBe(1);
    expect(result.error).toBe("Ошибка · Тикет с таким идентификатором не найден.\n");
    expect(result.output).toContain("MCP: support › get_ticket — ошибка");
    expect(complete).not.toHaveBeenCalled();
  });

  it("сервер без get_ticket — ошибка до вызова модели", async () => {
    const complete = model();
    const result = await run(["support", "T-1001", "вопрос"], ok(TICKET), [], complete, ["other_tool"]);
    expect(result.error).toBe("Ошибка · MCP-сервер поддержки не объявил инструмент get_ticket.\n");
    expect(complete).not.toHaveBeenCalled();
  });

  it("без аргументов и без вопроса называет, чего не хватает", async () => {
    expect((await run(["support"], ok(TICKET))).error).toBe("Ошибка · Не указаны тикет и вопрос клиента.\n");
    expect((await run(["support", "T-1001"], ok(TICKET))).error).toBe("Ошибка · Не указан вопрос клиента.\n");
  });

  it("без ключа сервер поддержки не запускается", async () => {
    const log: string[] = [];
    const result = await invoke(["support", "T-1001", "вопрос"], {
      cwd,
      authenticated: false,
      withToolSource: supportSession(ok(TICKET), log),
    });
    expect(result.code).toBe(1);
    expect(result.error).toContain("LAB_LLM_API_KEY");
    expect(log).toEqual([]);
  });
});
