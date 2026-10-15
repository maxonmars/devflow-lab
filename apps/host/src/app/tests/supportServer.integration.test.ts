import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelCompletion, ModelRequest } from "../../core/index.ts";
import { resolveServerEntrypoint } from "../serverEntrypoints.ts";
import { invoke, keywordEmbeddings, writeCorpus } from "./harness.ts";

const VOCABULARY = ["блокировк"];
const DATA = {
  users: [
    {
      id: "u-1",
      name: "Анна",
      email: "anna@example.com",
      plan: "pro",
      accountStatus: "locked",
      authMethod: "password",
      twoFactor: false,
    },
  ],
  tickets: [
    {
      id: "T-1",
      userId: "u-1",
      subject: "Не могу войти",
      status: "open",
      createdAt: "2026-10-12T09:00:00Z",
      messages: [{ from: "user", at: "2026-10-12T09:00:00Z", text: "Пишет про блокировку." }],
    },
  ],
};

let cwd: string;
beforeEach(async () => {
  cwd = mkdtempSync(join(tmpdir(), "devflow-lab-support-server-"));
  writeCorpus(cwd, {
    "docs/auth.md": "# Вход\n\nБлокировка аккаунта на 30 минут.",
    "support/tickets.json": JSON.stringify(DATA),
  });
  await invoke(["rag", "index"], { cwd, embeddings: keywordEmbeddings(VOCABULARY) });
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("сервер поддержки из host", () => {
  it("исходный запуск берёт src/app/main.ts, собранный — dist/app/main.js", () => {
    expect(resolveServerEntrypoint("file:///x/app/support.ts", "support")).toMatch(
      /servers\/support\/src\/app\/main\.ts$/,
    );
    expect(resolveServerEntrypoint("file:///x/app/support.js", "support")).toMatch(
      /servers\/support\/dist\/app\/main\.js$/,
    );
  });

  it("support запускает настоящий сервер с --data из project.root и передаёт тикет модели", async () => {
    const complete = vi.fn(
      async (_request: ModelRequest): Promise<ModelCompletion> => ({ type: "text", content: "## Ответ\nГотово." }),
    );
    const result = await invoke(["support", "T-1", "Почему блокировка?"], {
      cwd,
      complete,
      embeddings: keywordEmbeddings(VOCABULARY),
      nodeExecutable: process.execPath,
    });
    expect(result.error).toBe("");
    expect(result.code).toBe(0);
    const message = String(complete.mock.calls[0]?.[0].messages[1]?.content);
    expect(message).toContain("Тикет T-1: Не могу войти");
    expect(message).toContain("Статус аккаунта: временно заблокирован (locked)");
    expect(message).toContain("docs/auth.md");
    expect(result.output).toContain("MCP: support › get_ticket — выполнено");
  });
});
