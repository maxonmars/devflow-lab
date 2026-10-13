import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelCompletion, ModelRequest } from "../../core/index.ts";
import { gitServer, resolveServerEntrypoint } from "../serverEntrypoints.ts";
import { invoke } from "./harness.ts";

const GIT_ENV = {
  PATH: process.env.PATH ?? "",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.test",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.test",
};

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "devflow-lab-git-ask-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { env: GIT_ENV });
  git("init", "--quiet", "--initial-branch=feature/demo");
  writeFileSync(join(cwd, "README.md"), "# Проект\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "Старт");
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("git-сервер из host", () => {
  it("исходный запуск берёт src/app/main.ts, собранный — dist/app/main.js", () => {
    expect(resolveServerEntrypoint("file:///x/app/ask.ts", "git")).toMatch(/servers\/git\/src\/app\/main\.ts$/);
    expect(resolveServerEntrypoint("file:///x/app/ask.js", "git")).toMatch(/servers\/git\/dist\/app\/main\.js$/);
  });

  it("ask запускает настоящий сервер с корнем project.root и получает ветку через git_branch", async () => {
    const complete = vi.fn(async (request: ModelRequest): Promise<ModelCompletion> => {
      const last = request.messages.at(-1);
      if (last?.role === "tool") return { type: "text", content: `Ответ по данным: ${last.content}` };
      return { type: "tool_calls", calls: [{ id: "c1", name: "git_branch", arguments: {} }] };
    });
    const result = await invoke(["ask", "Какая ветка?"], {
      cwd,
      complete,
      mcpServers: (config) => [gitServer(config, cwd, process.execPath)],
    });
    expect(result.error).toBe("");
    expect(result.code).toBe(0);
    const first = complete.mock.calls[0]?.[0] as ModelRequest;
    expect(first.tools.map((tool) => tool.name)).toEqual(["git_branch", "git_status", "git_diff", "list_files"]);
    expect(result.output).toContain("MCP: git › git_branch — выполнено");
    expect(result.output).toContain("Ветка: feature/demo");
  });
});
