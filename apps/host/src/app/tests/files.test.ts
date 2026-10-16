import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelCompletion, ModelRequest, ToolCall, ToolResult, ToolSource } from "../../core/index.ts";
import type { StdioToolSourceOptions } from "../../features/mcp/index.ts";
import type { WithToolSource } from "../toolSources.ts";
import { invoke } from "./harness.ts";

const README = "# Лимиты\n\nMAX_FILE_MB: 10\nMAX_FILES: 20\n";
const GOAL = "Обнови README под изменения";
const ALL_FILES_TOOLS = ["files_search", "files_read", "files_write"];

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "devflow-lab-files-"));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const gitServer: StdioToolSourceOptions = { command: "node", args: ["git.js"], serverName: "git", timeoutMs: 1000 };
const ok = (content: string): ToolResult => ({ content, isError: false });

type Fake = {
  /** Содержимое, которое вернёт каждый следующий `files_read` по пути; последнее повторяется. */
  reads?: Record<string, string[]>;
  /** Пути, запись которых завершается ошибкой сервера. */
  failWrites?: string[];
  filesTools?: string[];
};

/** Подмена git- и files-серверов по `serverName`; `log` — открытия, вызовы и записи. */
function fakeSessions(fake: Fake = {}) {
  const log: string[] = [];
  const writes: Record<string, string> = {};
  const reads = new Map(Object.entries({ "README.md": [README], ...fake.reads }));
  const filesSource: ToolSource = {
    listTools: async () =>
      (fake.filesTools ?? ALL_FILES_TOOLS).map((name) => ({ name, inputSchema: { type: "object" } })),
    callTool: async ({ name, arguments: args }) => {
      const path = String(args.path);
      log.push(`${name} ${name === "files_search" ? args.query : path}`);
      if (name === "files_search") return ok("Совпадения «withSessions» (1):\nsrc/a.ts:3: withSessions(");
      if (name === "files_read") {
        const queue = reads.get(path);
        if (!queue) return { content: "Файл не найден среди видимых файлов проекта.", isError: true };
        return ok(queue.length > 1 ? (queue.shift() as string) : (queue[0] as string));
      }
      if (fake.failWrites?.includes(path)) return { content: "Не удалось записать файл.", isError: true };
      writes[path] = String(args.content);
      return ok(`Записан файл ${path}.`);
    },
  };
  const gitSource: ToolSource = {
    listTools: async () => ["git_status", "read_file"].map((name) => ({ name, inputSchema: { type: "object" } })),
    callTool: async () => ok("## main\n M src/limits.ts"),
  };
  const withToolSource: WithToolSource = async (options, use) => {
    log.push(`open ${options.serverName}`);
    try {
      return await use(options.serverName === "files" ? filesSource : gitSource);
    } finally {
      log.push(`close ${options.serverName}`);
    }
  };
  return { log, writes, withToolSource };
}

const call = (name: string, args: ToolCall["arguments"]): ModelCompletion => ({
  type: "tool_calls",
  calls: [{ id: `c-${name}`, name, arguments: args }],
});
const text = (content: string): ModelCompletion => ({ type: "text", content });
const script = (...steps: ModelCompletion[]) => {
  const complete = vi.fn(async (_request: ModelRequest): Promise<ModelCompletion> => text("конец сценария"));
  for (const step of steps) complete.mockResolvedValueOnce(step);
  return complete;
};
const editStep = (old = "MAX_FILE_MB: 10", replacement = "MAX_FILE_MB: 25") =>
  call("propose_edit", { path: "README.md", old, new: replacement });

function run(argv: string[], fake: ReturnType<typeof fakeSessions>, complete = script(), input = "", tty = true) {
  return invoke(argv, {
    cwd,
    complete,
    input,
    interactive: tty,
    mcpServers: () => [gitServer],
    withToolSource: fake.withToolSource,
  });
}

describe("files: поиск без правок", () => {
  it("модель вызывает files_search и отвечает текстом; вопроса и записи нет", async () => {
    const fake = fakeSessions();
    const complete = script(call("files_search", { query: "withSessions" }), text("src/a.ts:3 — вызов"));
    const result = await run(["files", "Найди", "withSessions"], fake, complete, "y\n");
    expect(result.error).toBe("");
    expect(result.code).toBe(0);
    expect(fake.log).toEqual(["open files", "open git", "files_search withSessions", "close git", "close files"]);
    expect(result.output).toContain("── Ассистент файлов · deepseek · deepseek-flash ──");
    expect(result.output).toContain("MCP: files › files_search — выполнено");
    expect(result.output).toContain("src/a.ts:3 — вызов");
    expect(result.output).not.toContain("[y/N]");
    expect(fake.writes).toEqual({});
  });

  it("модель не видит files_write и read_file git-сервера, но видит propose_edit и остальное", async () => {
    const complete = script(text("готово"));
    await run(["files", "цель"], fakeSessions(), complete);
    const request = complete.mock.calls[0]?.[0];
    const names = request?.tools.map((tool) => tool.name).sort();
    expect(names).toEqual(["files_read", "files_search", "git_status", "propose_edit"]);
    expect(request?.toolChoice).toBe("auto");
    expect(String(request?.messages[0]?.content)).toContain("propose_edit");
  });
});

describe("files: правки и подтверждение", () => {
  it("«y»: diff печатается, затем files_write получает итоговое содержимое", async () => {
    const fake = fakeSessions();
    const result = await run(["files", GOAL], fake, script(editStep(), text("Предлагаю правку.")), "y\n");
    expect(result.error).toBe("");
    expect(fake.writes).toEqual({ "README.md": "# Лимиты\n\nMAX_FILE_MB: 25\nMAX_FILES: 20\n" });
    expect(fake.log).toEqual(
      expect.arrayContaining(["files_read README.md", "files_write README.md", "close git", "close files"]),
    );
    expect(result.output).toContain("Правка: README.md — принята");
    expect(result.output).toContain("## Предложенные изменения\n\n### README.md\n\n```diff\n--- a/README.md");
    expect(result.output).toContain("-MAX_FILE_MB: 10\n+MAX_FILE_MB: 25");
    expect(result.output).toContain("Применить изменения (файлов: 1)? [y/N] ");
    expect(result.output).toContain("MCP: files › files_write — выполнено");
    expect(result.output).toContain("Записано: README.md");
    expect(result.output.indexOf("## Предложенные изменения")).toBeLessThan(result.output.indexOf("[y/N]"));
  });

  it.each(["n\n", "\n", "", "нет\n"])("ответ «%s» — запись не выполняется", async (input) => {
    const fake = fakeSessions();
    const result = await run(["files", GOAL], fake, script(editStep(), text("Предлагаю.")), input);
    expect(fake.writes).toEqual({});
    expect(fake.log.filter((line) => line.startsWith("open"))).toEqual(["open files", "open git"]);
    expect(result.output).toContain("Изменения не применены.");
    expect(result.code).toBe(0);
  });

  it("без TTY: diff и сообщение, вопроса и записи нет", async () => {
    const fake = fakeSessions();
    const result = await run(["files", GOAL], fake, script(editStep(), text("Предлагаю.")), "y\n", false);
    expect(fake.writes).toEqual({});
    expect(result.output).toContain("+MAX_FILE_MB: 25");
    expect(result.output).not.toContain("[y/N]");
    expect(result.output).toContain("подтверждение возможно только при запуске `files` одной командой в терминале");
  });

  it("REPL: /files показывает diff, но не спрашивает и не пишет, даже при TTY и ответе «y»", async () => {
    const fake = fakeSessions();
    const result = await run([], fake, script(editStep(), text("Предлагаю.")), `/files ${GOAL}\ny\n`);
    expect(fake.writes).toEqual({});
    expect(result.output).toContain("+MAX_FILE_MB: 25");
    expect(result.output).not.toContain("Применить изменения");
    expect(result.output).toContain("подтверждение возможно только при запуске `files` одной командой в терминале");
  });

  it("файл изменился между предложением и подтверждением — пропущен, files_write не вызван", async () => {
    const fake = fakeSessions({ reads: { "README.md": [README, `${README}Дописано руками\n`] } });
    const result = await run(["files", GOAL], fake, script(editStep(), text("Предлагаю.")), "y\n");
    expect(fake.writes).toEqual({});
    expect(fake.log).not.toContain("files_write README.md");
    expect(result.output).toContain("Пропущено: README.md — файл изменился после предложения правки");
  });

  it("ошибка записи одного файла не мешает остальным; итог по каждому", async () => {
    const reads = { "docs/a.md": ["альфа\n"], "docs/b.md": ["бета\n"] };
    const fake = fakeSessions({ reads, failWrites: ["docs/a.md"] });
    const steps = [
      call("propose_edit", { path: "docs/a.md", old: "альфа", new: "A" }),
      call("propose_edit", { path: "docs/b.md", old: "бета", new: "B" }),
      text("Две правки."),
    ];
    const result = await run(["files", GOAL], fake, script(...steps), "да\n");
    expect(fake.writes).toEqual({ "docs/b.md": "B\n" });
    expect(result.output).toContain("Применить изменения (файлов: 2)?");
    expect(result.output).toContain("Ошибка: docs/a.md — Не удалось записать файл.");
    expect(result.output).toContain("Записано: docs/b.md");
  });

  it("отклонённая правка возвращается модели с причиной; без принятых правок вопроса нет", async () => {
    const fake = fakeSessions();
    const complete = script(editStep("нет такого фрагмента", "x"), text("Не нашёл."));
    const result = await run(["files", GOAL], fake, complete, "y\n");
    const toolMessage = complete.mock.calls[1]?.[0].messages.at(-1);
    expect(toolMessage).toMatchObject({ role: "tool", content: "Фрагмент old не найден в README.md." });
    expect(result.output).toContain("Правка: README.md — отклонена");
    expect(result.output).not.toContain("[y/N]");
    expect(fake.writes).toEqual({});
  });

  it("правка не-.md отклоняется до чтения файла", async () => {
    const fake = fakeSessions();
    const step = call("propose_edit", { path: "src/limits.ts", old: "10", new: "25" });
    const result = await run(["files", GOAL], fake, script(step, text("Нельзя.")), "y\n");
    expect(fake.log).not.toContain("files_read src/limits.ts");
    expect(result.output).toContain("Правка: src/limits.ts — отклонена");
    expect(fake.writes).toEqual({});
  });
});

describe("files: проверки перед запуском", () => {
  it("files-сервер без files_write — ошибка, модель не вызывается", async () => {
    const complete = script();
    const fake = fakeSessions({ filesTools: ["files_search", "files_read"] });
    const result = await run(["files", GOAL], fake, complete);
    expect(result.code).toBe(1);
    expect(result.error).toBe(
      "Ошибка · MCP-сервер files не объявил инструменты files_search, files_read, files_write.\n",
    );
    expect(complete).not.toHaveBeenCalled();
  });

  it("без цели называет, чего не хватает", async () => {
    const result = await run(["files"], fakeSessions());
    expect(result.error).toBe("Ошибка · Не указана цель для работы с файлами.\n");
  });

  it("без ключа серверы не запускаются", async () => {
    const fake = fakeSessions();
    const result = await invoke(["files", GOAL], { cwd, authenticated: false, withToolSource: fake.withToolSource });
    expect(result.code).toBe(1);
    expect(result.error).toContain("LAB_LLM_API_KEY");
    expect(fake.log).toEqual([]);
  });

  it("лимит вызовов инструментов — 15: после него модель получает toolChoice none", async () => {
    const complete = script(...Array.from({ length: 15 }, () => call("files_search", { query: "x" })), text("Хватит."));
    const result = await run(["files", "цель"], fakeSessions(), complete);
    expect(result.error).toBe("");
    expect(complete.mock.calls.at(-1)?.[0].toolChoice).toBe("none");
  });
});
