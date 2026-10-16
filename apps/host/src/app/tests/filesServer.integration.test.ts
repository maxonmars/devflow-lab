import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelCompletion, ModelRequest } from "../../core/index.ts";
import { invoke } from "./harness.ts";

const README = "# Лимиты\n\nMAX_FILE_MB: 10\n";
const toolCall = (name: string, args: Record<string, string>): ModelCompletion => ({
  type: "tool_calls",
  calls: [{ id: `call-${name}`, name, arguments: args }],
});
const EDIT = toolCall("propose_edit", { path: "README.md", old: "MAX_FILE_MB: 10", new: "MAX_FILE_MB: 25" });

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "devflow-lab-files-server-"));
  execFileSync("git", ["-C", cwd, "init", "--quiet"]);
  writeFileSync(join(cwd, "README.md"), README);
  writeFileSync(join(cwd, ".gitignore"), ".env\n");
  writeFileSync(join(cwd, ".env"), "LAB_LLM_API_KEY=secret-MAX_FILE_MB\n");
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function script(...steps: ModelCompletion[]) {
  const complete = vi.fn(
    async (_request: ModelRequest): Promise<ModelCompletion> => ({ type: "text", content: "Готово." }),
  );
  for (const step of steps) complete.mockResolvedValueOnce(step);
  return complete;
}

const run = (complete: ReturnType<typeof script>, input = "") =>
  invoke(["files", "Обнови README"], { cwd, complete, input, interactive: true, nodeExecutable: process.execPath });

describe("files-сервер из host", () => {
  it("«y»: plan читает README через настоящий сервер, apply меняет файл на диске", async () => {
    const result = await run(script(EDIT), "y\n");
    expect(result.error).toBe("");
    expect(result.code).toBe(0);
    expect(readFileSync(join(cwd, "README.md"), "utf8")).toBe("# Лимиты\n\nMAX_FILE_MB: 25\n");
    expect(result.output).toContain("MCP: files › files_read — выполнено");
    expect(result.output).toContain("MCP: files › files_write — выполнено");
    expect(result.output).toContain("-MAX_FILE_MB: 10\n+MAX_FILE_MB: 25");
    expect(result.output).toContain("Записано: README.md");
  });

  it("«n»: файл на диске не меняется, files_write не вызывается", async () => {
    const result = await run(script(EDIT), "n\n");
    expect(readFileSync(join(cwd, "README.md"), "utf8")).toBe(README);
    expect(result.output).not.toContain("files_write");
    expect(result.output).toContain("Изменения не применены.");
  });

  it("поиск не видит игнорируемый .env, чтение игнорируемого файла возвращает ошибку модели", async () => {
    const search = toolCall("files_search", { query: "MAX_FILE_MB" });
    const complete = script(search, toolCall("files_read", { path: ".env" }));
    const result = await run(complete);
    expect(result.error).toBe("");
    const results = complete.mock.calls.at(-1)?.[0].messages.filter((message) => message.role === "tool") ?? [];
    expect(results[0]?.content).toBe("Совпадения «MAX_FILE_MB» (1):\nREADME.md:3: MAX_FILE_MB: 10");
    expect(results[1]?.content).toContain("Файл не найден");
    expect(result.output).toContain("MCP: files › files_read — ошибка");
  });

  it("пустой .md читается как пустой текст, а не как ошибка протокола", async () => {
    writeFileSync(join(cwd, "empty.md"), "");
    const result = await run(script(toolCall("files_read", { path: "empty.md" })));
    expect(result.error).toBe("");
    expect(result.output).toContain("MCP: files › files_read — выполнено");
  });
});
