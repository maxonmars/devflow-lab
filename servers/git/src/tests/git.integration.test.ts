import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listFiles, readBranch, readDiff, readStatus } from "../git/readers.ts";
import { createGitRunner, describeGitError, GitError } from "../index.ts";
import { git, runnerFor, tempRepository, writeFiles } from "./support.ts";

let root: string;
beforeEach(() => {
  root = tempRepository();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => "NONE",
    (error: unknown) => (error instanceof GitError ? error.code : "OTHER"),
  );

describe("git на настоящем репозитории", () => {
  it("ветка, затем новая ветка и detached HEAD", async () => {
    const runGit = runnerFor(root);
    expect(await readBranch(runGit)).toMatchObject({ branch: "main", head: { subject: "Первый коммит" } });
    git(root, "switch", "--quiet", "-c", "feature/день-1");
    expect((await readBranch(runGit)).branch).toBe("feature/день-1");
    git(root, "switch", "--quiet", "--detach");
    expect((await readBranch(runGit)).branch).toBeNull();
  });

  it("status и diff различают рабочую копию и индекс", async () => {
    const runGit = runnerFor(root);
    writeFiles(root, { "README.md": "# Проект\n\nНовая строка\n", "docs/guide.md": "# Гайд\n\nВ индексе\n" });
    git(root, "add", "docs/guide.md");
    const status = await readStatus(runGit);
    expect(status.lines).toEqual(["## main", " M README.md", "M  docs/guide.md"]);
    const unstaged = await readDiff(runGit, { staged: false });
    expect(unstaged.stat).toContain("README.md");
    expect(unstaged.diff).toContain("+Новая строка");
    const staged = await readDiff(runGit, { staged: true, path: "docs" });
    expect(staged.diff).toContain("+В индексе");
    expect(staged.diff).not.toContain("README.md");
  });

  it("list_files показывает только отслеживаемые файлы: .env и новые файлы не видны", async () => {
    writeFiles(root, { ".env": "LAB_LLM_API_KEY=secret\n", "draft.md": "# Черновик\n" });
    const info = await listFiles(runnerFor(root), undefined);
    expect(info.files).toEqual([".gitignore", "README.md", "docs/guide.md"]);
    expect((await listFiles(runnerFor(root), "docs")).files).toEqual(["docs/guide.md"]);
  });

  it("корень-подкаталог: вывод не выходит за его пределы", async () => {
    writeFiles(root, { "README.md": "# Изменён\n", "docs/guide.md": "# Изменён\n" });
    const runGit = runnerFor(join(root, "docs"));
    expect((await listFiles(runGit, undefined)).files).toEqual(["guide.md"]);
    expect((await readStatus(runGit)).lines).toEqual(["## main", " M guide.md"]);
    expect((await readDiff(runGit, { staged: false })).stat).not.toContain("README.md");
  });

  it("пустой репозиторий и каталог вне git дают понятные ошибки", async () => {
    const empty = mkdtempSync(join(tmpdir(), "devflow-lab-git-empty-"));
    const outside = mkdtempSync(join(tmpdir(), "devflow-lab-git-outside-"));
    try {
      git(empty, "init", "--quiet", "--initial-branch=main");
      expect(await readBranch(runnerFor(empty))).toEqual({ branch: "main", head: null });
      mkdirSync(join(outside, "plain"));
      const error = await readBranch(runnerFor(join(outside, "plain"))).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(GitError);
      expect(describeGitError(error)).toBe("Корень проекта не находится внутри git-репозитория.");
    } finally {
      rmSync(empty, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("отсутствующий git и таймаут распознаются", async () => {
    const noGit = createGitRunner({ root, env: { PATH: "/nonexistent" } });
    expect(await codeOf(noGit(["status"]))).toBe("GIT_NOT_FOUND");
    // `cat-file --batch` ждёт запросы из stdin, который execFile не закрывает: команда не завершится сама.
    const waiting = createGitRunner({ root, env: { PATH: process.env.PATH ?? "" }, timeoutMs: 200 });
    expect(await codeOf(waiting(["cat-file", "--batch"]))).toBe("TIMEOUT");
  });
});
