import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createGitRunner, type FilesContext, type RunGit } from "../index.ts";

const ENV = {
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.test",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.test",
};

export function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { env: ENV, encoding: "utf8" });
}

export function writeFiles(root: string, files: Readonly<Record<string, string>>): void {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
}

/** Временный репозиторий: README.md и docs/guide.md в коммите, `.env` и `.local/` в .gitignore. */
export function tempRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "devflow-lab-files-"));
  git(root, "init", "--quiet", "--initial-branch=main");
  writeFiles(root, {
    "README.md": "# Проект\n\nwithSessions описан здесь.\n",
    "docs/guide.md": "# Гайд\n\nwithSessions открывает сессии.\n",
    "src/code.ts": "export const withSessions = 1;\n",
    ".gitignore": ".env\n.local/\n",
  });
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "Первый коммит");
  return root;
}

export const runnerFor = (root: string): RunGit => createGitRunner({ root, env: ENV });
export const contextFor = (root: string): FilesContext => ({ root, runGit: runnerFor(root) });

/** Подмена git: ответ по первому аргументу команды; функция — для ошибок и проверки аргументов. */
export function fakeGit(answers: Readonly<Record<string, string | ((args: readonly string[]) => string)>>): RunGit {
  return async (args) => {
    const answer = answers[args[0] ?? ""];
    if (answer === undefined) throw new Error(`неожиданная команда git ${args[0]}`);
    return typeof answer === "function" ? answer(args) : answer;
  };
}
