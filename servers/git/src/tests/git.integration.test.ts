import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listFiles,
  MAX_FILE_CHARS,
  readBranch,
  readChangedFiles,
  readDiff,
  readFile,
  readStatus,
} from "../git/readers.ts";
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

describe("ветка относительно базы и файлы HEAD", () => {
  /** main: README, guide, rename-me; feature: M README, A src/new.ts, D guide, R rename-me → renamed; затем коммит в main. */
  function branchFromMain(): void {
    writeFiles(root, { "docs/rename-me.md": `# Переименуемый\n\n${"строка текста\n".repeat(20)}` });
    git(root, "add", ".");
    git(root, "commit", "--quiet", "-m", "Файл для переименования");
    git(root, "switch", "--quiet", "-c", "feature");
    writeFiles(root, { "README.md": "# Проект\n\nВ ветке\n", "src/new.ts": "export const x = 1;\n" });
    git(root, "rm", "--quiet", "docs/guide.md");
    git(root, "mv", "docs/rename-me.md", "docs/renamed.md");
    git(root, "add", ".");
    git(root, "commit", "--quiet", "-m", "Изменения ветки");
    git(root, "switch", "--quiet", "main");
    writeFiles(root, { "late.md": "# Позже\n" });
    git(root, "add", ".");
    git(root, "commit", "--quiet", "-m", "Коммит в main после ответвления");
    git(root, "switch", "--quiet", "feature");
  }

  it("A, M, D и R относительно merge-base; коммиты main после ответвления не входят", async () => {
    branchFromMain();
    const runGit = runnerFor(root);
    const info = await readChangedFiles(runGit, "main");
    expect(info).toMatchObject({ total: 4, truncated: false });
    expect(info.files).toEqual(
      expect.arrayContaining([
        { status: "M", path: "README.md" },
        { status: "A", path: "src/new.ts" },
        { status: "D", path: "docs/guide.md" },
        { status: "R", path: "docs/renamed.md", from: "docs/rename-me.md" },
      ]),
    );
    const diff = await readDiff(runGit, { staged: false, base: "main", path: "README.md" });
    expect(diff.diff).toContain("+В ветке");
    expect((await readDiff(runGit, { staged: false, base: "main" })).stat).not.toContain("late.md");
  });

  it("неизвестный ref базы — UNKNOWN_REF", async () => {
    const runGit = runnerFor(root);
    expect(await codeOf(readChangedFiles(runGit, "no-such-ref"))).toBe("UNKNOWN_REF");
    expect(await codeOf(readDiff(runGit, { staged: false, base: "no-such-ref" }))).toBe("UNKNOWN_REF");
  });

  it("read_file: содержимое HEAD; неотслеживаемый и отсутствующий файл — FILE_NOT_FOUND", async () => {
    writeFiles(root, { "README.md": "# Изменён на диске\n", "draft.md": "# Черновик\n" });
    const runGit = runnerFor(root);
    expect(await readFile(runGit, "README.md")).toMatchObject({ content: "# Проект\n", binary: false });
    expect(await codeOf(readFile(runGit, "draft.md"))).toBe("FILE_NOT_FOUND");
    expect(await codeOf(readFile(runGit, "missing.md"))).toBe("FILE_NOT_FOUND");
  });

  it("read_file: двоичный файл без содержимого, длинный обрезается по кодовым точкам", async () => {
    writeFiles(root, { "image.bin": "PNG\0\x01", "long.md": "ё".repeat(MAX_FILE_CHARS + 5) });
    git(root, "add", ".");
    git(root, "commit", "--quiet", "-m", "Двоичный и длинный");
    const runGit = runnerFor(root);
    expect(await readFile(runGit, "image.bin")).toMatchObject({ binary: true, content: "" });
    const long = await readFile(runGit, "long.md");
    expect(long).toMatchObject({ totalChars: MAX_FILE_CHARS + 5, truncated: true });
    expect([...long.content]).toHaveLength(MAX_FILE_CHARS);
  });

  it("корень-подкаталог: пути изменений и read_file — от корня проекта", async () => {
    branchFromMain();
    const runGit = runnerFor(join(root, "docs"));
    const info = await readChangedFiles(runGit, "main");
    expect(info.files).toEqual(
      expect.arrayContaining([
        { status: "D", path: "guide.md" },
        { status: "R", path: "renamed.md", from: "rename-me.md" },
      ]),
    );
    expect(info.total).toBe(2);
    expect((await readFile(runGit, "renamed.md")).content).toContain("# Переименуемый");
  });
});
