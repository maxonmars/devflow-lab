import { describe, expect, it } from "vitest";
import { GitError } from "../git/errors.ts";
import {
  listFiles,
  MAX_DIFF_CHARS,
  MAX_FILES,
  MAX_STATUS_LINES,
  readBranch,
  readDiff,
  readStatus,
} from "../git/readers.ts";
import { branchText, diffText, filesText, statusText } from "../server/format.ts";
import { fakeGit } from "./support.ts";

const fail = (error: GitError) => () => {
  throw error;
};

describe("git_branch", () => {
  it("ветка и последний коммит", async () => {
    const info = await readBranch(fakeGit({ "symbolic-ref": "main\n", log: "abc1234\0Первый коммит\n" }));
    expect(info).toEqual({ branch: "main", head: { sha: "abc1234", subject: "Первый коммит" } });
    expect(branchText(info)).toBe("Ветка: main\nHEAD: abc1234 Первый коммит");
  });

  it("код 1 у symbolic-ref — HEAD отсоединён, а не ошибка", async () => {
    const info = await readBranch(
      fakeGit({ "symbolic-ref": fail(new GitError("FAILED", 1)), log: "abc1234\0Коммит\n" }),
    );
    expect(info.branch).toBeNull();
    expect(branchText(info)).toBe("HEAD отсоединён от ветки (detached): abc1234 Коммит");
  });

  it("ветка без коммитов", async () => {
    const info = await readBranch(fakeGit({ "symbolic-ref": "main\n", log: fail(new GitError("NO_COMMITS")) }));
    expect(branchText(info)).toBe("Ветка: main\nHEAD: коммитов пока нет");
  });

  it("другие ошибки git проходят наружу", async () => {
    await expect(readBranch(fakeGit({ "symbolic-ref": fail(new GitError("NOT_A_REPOSITORY")) }))).rejects.toThrow(
      "NOT_A_REPOSITORY",
    );
    await expect(readBranch(fakeGit({ "symbolic-ref": fail(new GitError("FAILED", 128)) }))).rejects.toThrow("FAILED");
  });
});

describe("git_status", () => {
  it("ограничен корнем проекта и числом строк", async () => {
    let seen: readonly string[] = [];
    const lines = ["## main", ...Array.from({ length: MAX_STATUS_LINES + 5 }, (_, i) => ` M f${i}.md`)];
    const info = await readStatus(
      fakeGit({
        status: (args) => {
          seen = args;
          return `${lines.join("\n")}\n`;
        },
      }),
    );
    expect(seen.slice(-2)).toEqual(["--", "."]);
    expect(info).toMatchObject({ total: MAX_STATUS_LINES + 6, truncated: true });
    expect(info.lines).toHaveLength(MAX_STATUS_LINES);
    expect(statusText(info)).toContain(`Показано ${MAX_STATUS_LINES} из ${MAX_STATUS_LINES + 6} строк.`);
  });

  it("без изменений", () => {
    expect(statusText({ lines: ["## main...origin/main"], total: 1, truncated: false })).toBe(
      "## main...origin/main\nИзменений нет.",
    );
  });
});

describe("git_diff", () => {
  it("staged и путь передаются git, внешние драйверы выключены, длинный diff обрезается", async () => {
    const calls: (readonly string[])[] = [];
    const long = "ё".repeat(MAX_DIFF_CHARS + 10);
    const info = await readDiff(
      fakeGit({
        diff: (args) => {
          calls.push(args);
          return args.includes("--stat") ? " a.md | 2 +-\n" : long;
        },
      }),
      { staged: true, path: "docs" },
    );
    for (const args of calls) {
      expect(args).toEqual(expect.arrayContaining(["--cached", "--no-ext-diff", "--no-textconv"]));
      expect(args.slice(-2)).toEqual(["--", "docs"]);
    }
    expect(info).toMatchObject({ totalChars: MAX_DIFF_CHARS + 10, truncated: true });
    expect([...info.diff]).toHaveLength(MAX_DIFF_CHARS);
    expect(diffText(info, true)).toContain(
      `Diff обрезан: показано ${MAX_DIFF_CHARS} из ${MAX_DIFF_CHARS + 10} символов.`,
    );
  });

  it("без изменений называет область", async () => {
    const info = await readDiff(fakeGit({ diff: "" }), { staged: false });
    expect(diffText(info, false)).toBe("Изменения рабочей копии (не в индексе): изменений нет.");
  });
});

describe("list_files", () => {
  it("разбирает вывод -z и ограничивает число файлов", async () => {
    const names = Array.from({ length: MAX_FILES + 1 }, (_, i) => `docs/f${i}.md`);
    const info = await listFiles(fakeGit({ "ls-files": `${names.join("\0")}\0` }), "docs");
    expect(info).toMatchObject({ total: MAX_FILES + 1, truncated: true });
    expect(filesText(info, "docs")).toContain(`Показано ${MAX_FILES} из ${MAX_FILES + 1}.`);
  });

  it("пустой результат", () => {
    expect(filesText({ files: [], total: 0, truncated: false }, "nope")).toBe("Отслеживаемых файлов в nope нет.");
  });
});
