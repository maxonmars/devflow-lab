import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FilesError,
  MAX_READ_CHARS,
  readVisibleFile,
  type SearchOptions,
  searchFiles,
  writeVisibleFile,
} from "../index.ts";
import { contextFor, git, tempRepository, writeFiles } from "./support.ts";

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
    (error: unknown) => (error instanceof FilesError ? error.code : "OTHER"),
  );

const find = (query: string, options: Partial<SearchOptions> = {}, at = root) =>
  searchFiles(contextFor(at), { query, ignoreCase: false, ...options });

describe("files_search на настоящем git", () => {
  it("находит отслеживаемый и неотслеживаемый файл, но не игнорируемые", async () => {
    writeFiles(root, {
      "draft.md": "withSessions в черновике\n",
      ".env": "withSessions=secret\n",
      ".local/note.md": "withSessions в индексе\n",
    });
    const info = await find("withSessions");
    expect(info.matches.map((match) => `${match.path}:${match.line}`)).toEqual([
      "README.md:3",
      "docs/guide.md:3",
      "draft.md:1",
      "src/code.ts:1",
    ]);
    expect(info.matches[0]?.text).toBe("withSessions описан здесь.");
  });

  it("ignoreCase и path сужают поиск", async () => {
    expect((await find("WITHSESSIONS")).total).toBe(0);
    expect((await find("WITHSESSIONS", { ignoreCase: true })).total).toBe(3);
    expect((await find("withSessions", { path: "docs" })).matches.map((match) => match.path)).toEqual([
      "docs/guide.md",
    ]);
  });

  it("запрос ищется как строка, а не как регулярное выражение или опция", async () => {
    writeFiles(root, { "a.md": "a.b и --help\n" });
    expect((await find("a.b")).total).toBe(1);
    expect((await find("a.*b")).total).toBe(0);
    expect((await find("--help")).total).toBe(1);
  });

  it("совпадений нет — пустой результат; корень-подкаталог ищет только в нём", async () => {
    expect((await find("нет такого слова")).total).toBe(0);
    expect((await find("withSessions", {}, join(root, "docs"))).matches.map((match) => match.path)).toEqual([
      "guide.md",
    ]);
  });

  it("двоичный файл пропускается", async () => {
    writeFileSync(join(root, "bin.dat"), Buffer.from("withSessions\0\x01"));
    expect((await find("withSessions")).matches.map((match) => match.path)).not.toContain("bin.dat");
  });
});

describe("files_read на настоящем git", () => {
  it("рабочая копия дословно, включая новый неотслеживаемый .md", async () => {
    writeFiles(root, { "README.md": "# Проект\n\nИзменено\n", "new.md": "Новый\n" });
    expect(await readVisibleFile(contextFor(root), "README.md")).toBe("# Проект\n\nИзменено\n");
    expect(await readVisibleFile(contextFor(root), "new.md")).toBe("Новый\n");
    expect(await readVisibleFile(contextFor(root), "./docs/guide.md")).toBe(
      "# Гайд\n\nwithSessions открывает сессии.\n",
    );
  });

  it("корень-подкаталог читает пути от корня проекта", async () => {
    expect(await readVisibleFile(contextFor(join(root, "docs")), "guide.md")).toContain("# Гайд");
  });

  it("игнорируемый, несуществующий и каталог — не найдены", async () => {
    writeFiles(root, { ".env": "KEY=secret\n", ".local/x.md": "x\n" });
    const context = contextFor(root);
    for (const path of [".env", ".local/x.md", "нет.md", "docs", "."]) {
      expect(await codeOf(readVisibleFile(context, path))).toBe("FILE_NOT_FOUND");
    }
  });

  it("удалённый с диска, но отслеживаемый файл — не найден", async () => {
    rmSync(join(root, "README.md"));
    expect(await codeOf(readVisibleFile(contextFor(root), "README.md"))).toBe("FILE_NOT_FOUND");
  });

  it("symlink отклоняется, в том числе на файл внутри корня", async () => {
    symlinkSync("README.md", join(root, "link.md"));
    expect(await codeOf(readVisibleFile(contextFor(root), "link.md"))).toBe("NOT_A_FILE");
  });

  it("файл через symlink-каталог не выходит за корень", async () => {
    const outside = tempRepository();
    try {
      symlinkSync(outside, join(root, "out"));
      expect(await codeOf(readVisibleFile(contextFor(root), "out/README.md"))).toBe("FILE_NOT_FOUND");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("двоичный и не-UTF-8 файлы — ошибка, слишком большой — ошибка, а не обрезанный текст", async () => {
    writeFileSync(join(root, "bin.md"), Buffer.from("текст\0\x01"));
    writeFileSync(join(root, "latin.md"), Buffer.from([0xff, 0xfe, 0x41]));
    writeFiles(root, { "big.md": "ж".repeat(MAX_READ_CHARS + 1) });
    const context = contextFor(root);
    expect(await codeOf(readVisibleFile(context, "bin.md"))).toBe("BINARY");
    expect(await codeOf(readVisibleFile(context, "latin.md"))).toBe("BINARY");
    expect(await codeOf(readVisibleFile(context, "big.md"))).toBe("TOO_LARGE");
  });

  it("файл ровно в лимит читается целиком", async () => {
    writeFiles(root, { "limit.md": "ж".repeat(MAX_READ_CHARS) });
    expect([...(await readVisibleFile(contextFor(root), "limit.md"))]).toHaveLength(MAX_READ_CHARS);
  });

  it("BOM сохраняется в тексте", async () => {
    writeFileSync(join(root, "bom.md"), "﻿текст\n");
    expect(await readVisibleFile(contextFor(root), "bom.md")).toBe("﻿текст\n");
  });
});

describe("files_write на настоящем git", () => {
  it("заменяет .md, сохраняет права и не оставляет временных файлов", async () => {
    chmodSync(join(root, "README.md"), 0o755);
    await writeVisibleFile(contextFor(root), "README.md", "# Новый\n");
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("# Новый\n");
    expect(statSync(join(root, "README.md")).mode & 0o777).toBe(0o755);
    expect(readdirSync(root).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(git(root, "status", "--short")).toBe(" M README.md\n");
  });

  it("пишет неотслеживаемый .md в подкаталоге", async () => {
    writeFiles(root, { "notes/a.md": "старый\n" });
    await writeVisibleFile(contextFor(root), "notes/a.md", "новый\n");
    expect(readFileSync(join(root, "notes/a.md"), "utf8")).toBe("новый\n");
  });

  it("несуществующий и игнорируемый файлы не создаются", async () => {
    mkdirSync(join(root, ".local"));
    writeFiles(root, { ".local/x.md": "старый\n" });
    const context = contextFor(root);
    expect(await codeOf(writeVisibleFile(context, "новый.md", "x"))).toBe("FILE_NOT_FOUND");
    expect(await codeOf(writeVisibleFile(context, ".local/x.md", "x"))).toBe("FILE_NOT_FOUND");
    expect(readFileSync(join(root, ".local/x.md"), "utf8")).toBe("старый\n");
    expect(readdirSync(root)).not.toContain("новый.md");
  });

  it("symlink не записывается, цель остаётся прежней", async () => {
    symlinkSync("README.md", join(root, "link.md"));
    expect(await codeOf(writeVisibleFile(contextFor(root), "link.md", "x"))).toBe("NOT_A_FILE");
    expect(readFileSync(join(root, "README.md"), "utf8")).toContain("# Проект");
  });

  it("ошибка записи: WRITE_FAILED и временного файла не остаётся", async () => {
    chmodSync(root, 0o555);
    try {
      expect(await codeOf(writeVisibleFile(contextFor(root), "README.md", "x"))).toBe("WRITE_FAILED");
    } finally {
      chmodSync(root, 0o755);
    }
    expect(readdirSync(root).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(readFileSync(join(root, "README.md"), "utf8")).toContain("# Проект");
  });
});
