import { describe, expect, it } from "vitest";
import { GitError } from "../git/errors.ts";
import {
  listFiles,
  MAX_CHANGED_FILES,
  MAX_DIFF_CHARS,
  MAX_FILES,
  MAX_STATUS_LINES,
  parseNameStatus,
  readBranch,
  readChangedFiles,
  readDiff,
  readStatus,
} from "../git/readers.ts";
import { branchText, changesText, diffText, filesText, fileText, statusText } from "../server/format.ts";
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

describe("изменения относительно базы", () => {
  it("разбор -z: у R и C два пути, статус сокращается до буквы", () => {
    const output = [
      "M",
      "a.md",
      "R087",
      "old.md",
      "new.md",
      "A",
      "dir/b c.md",
      "C100",
      "x.md",
      "y.md",
      "D",
      "z.md",
      "",
    ];
    expect(parseNameStatus(output.join("\0"))).toEqual([
      { status: "M", path: "a.md" },
      { status: "R", path: "new.md", from: "old.md" },
      { status: "A", path: "dir/b c.md" },
      { status: "C", path: "y.md", from: "x.md" },
      { status: "D", path: "z.md" },
    ]);
    expect(parseNameStatus("")).toEqual([]);
  });

  it("текст git_changed_files — контракт для host", () => {
    const files = [
      { status: "M", path: "a.md" },
      { status: "R", path: "new.md", from: "old.md" },
    ];
    expect(changesText({ files, total: 2, truncated: false }, "origin/main")).toBe(
      "Изменённые файлы относительно origin/main (2):\nM a.md\nR new.md ← old.md",
    );
    expect(changesText({ files, total: 5, truncated: true }, "main")).toMatch(/\nПоказано 2 из 5\.$/);
    expect(changesText({ files: [], total: 0, truncated: false }, "main")).toBe(
      "Изменённых файлов относительно main нет.",
    );
  });

  it("ref проверяется до diff, список ограничен MAX_CHANGED_FILES", async () => {
    const commands: string[] = [];
    const names = Array.from({ length: MAX_CHANGED_FILES + 1 }, (_, i) => `M\0f${i}.md`).join("\0");
    const info = await readChangedFiles(
      fakeGit({
        "rev-parse": (args) => {
          commands.push(args.join(" "));
          return "abc\n";
        },
        diff: (args) => {
          commands.push(args.join(" "));
          return `${names}\0`;
        },
      }),
      "origin/main",
    );
    expect(commands[0]).toBe("rev-parse --verify --quiet origin/main^{commit}");
    expect(commands[1]).toContain("origin/main...HEAD -- .");
    expect(info).toMatchObject({ total: MAX_CHANGED_FILES + 1, truncated: true });
    expect(info.files).toHaveLength(MAX_CHANGED_FILES);
  });

  it("git_diff с base: диапазон base...HEAD без --cached и заголовок с базой", async () => {
    const calls: (readonly string[])[] = [];
    const info = await readDiff(
      fakeGit({
        "rev-parse": "abc\n",
        diff: (args) => {
          calls.push(args);
          return args.includes("--stat") ? " a.md | 1 +\n" : "+строка\n";
        },
      }),
      { staged: false, base: "main", path: "a.md" },
    );
    for (const args of calls) {
      expect(args).toContain("main...HEAD");
      expect(args).not.toContain("--cached");
    }
    expect(diffText(info, false, "main")).toBe("Изменения относительно main (base...HEAD):\n a.md | 1 +\n\n+строка");
  });
});

describe("read_file", () => {
  it("забор длиннее обратных кавычек в файле, обрезка и двоичный файл", () => {
    const text = fileText({
      path: "a.md",
      content: "````ts\nx\n````\n",
      totalChars: 30,
      truncated: true,
      binary: false,
    });
    expect(text).toBe("Файл a.md в HEAD (30 символов, показано 14):\n`````\n````ts\nx\n````\n`````");
    expect(fileText({ path: "b.bin", content: "", totalChars: 0, truncated: false, binary: true })).toBe(
      "Файл b.bin двоичный, содержимое не показывается.",
    );
  });
});
