import { describe, expect, it } from "vitest";
import { describeFilesError, FilesError, type FilesErrorCode } from "../files/errors.ts";
import { MAX_MATCH_LINE_CHARS, MAX_SEARCH_MATCHES, parseGrep, searchFiles } from "../files/readers.ts";
import { searchText } from "../server/format.ts";
import { fakeGit } from "./support.ts";

const row = (path: string, line: number, text: string) => `${path}\0${line}\0${text}\n`;
const search = (runGit: ReturnType<typeof fakeGit>, query = "q") =>
  searchFiles({ runGit, root: "/x" }, { query, ignoreCase: false });

describe("files_search: разбор git grep", () => {
  it("строки path\\0номер\\0текст становятся совпадениями", () => {
    expect(parseGrep(row("a.md", 3, "первая") + row("src/b.ts", 10, "вторая"))).toEqual([
      { path: "a.md", line: 3, text: "первая" },
      { path: "src/b.ts", line: 10, text: "вторая" },
    ]);
  });

  it("длинная строка обрезается по кодовым точкам", () => {
    const [match] = parseGrep(row("a.md", 1, "я".repeat(MAX_MATCH_LINE_CHARS + 50)));
    expect([...(match?.text ?? "")]).toHaveLength(MAX_MATCH_LINE_CHARS);
  });

  it("совпадений больше лимита: показаны первые, общее число сохраняется", async () => {
    const output = Array.from({ length: MAX_SEARCH_MATCHES + 5 }, (_, index) => row("a.md", index + 1, "x")).join("");
    const info = await search(fakeGit({ grep: output }));
    expect(info).toMatchObject({ total: MAX_SEARCH_MATCHES + 5, truncated: true });
    expect(info.matches).toHaveLength(MAX_SEARCH_MATCHES);
    expect(searchText(info, "x")).toContain(`Показано ${MAX_SEARCH_MATCHES} из ${MAX_SEARCH_MATCHES + 5}.`);
  });

  it("код 1 без вывода — совпадений нет, а не ошибка", async () => {
    const runGit = fakeGit({
      grep: () => {
        throw new FilesError("FAILED", 1);
      },
    });
    const info = await search(runGit);
    expect(info).toEqual({ matches: [], total: 0, truncated: false });
    expect(searchText(info, "нет такого")).toBe("Совпадений «нет такого» нет.");
  });

  it("другая ошибка git пробрасывается", async () => {
    const runGit = fakeGit({
      grep: () => {
        throw new FilesError("FAILED", 128);
      },
    });
    await expect(search(runGit)).rejects.toMatchObject({ code: "FAILED", exitCode: 128 });
  });

  it("текст результата: заголовок и строки путь:номер: текст", () => {
    const info = { matches: [{ path: "a.md", line: 3, text: "первая" }], total: 1, truncated: false };
    expect(searchText(info, "пер")).toBe("Совпадения «пер» (1):\na.md:3: первая");
  });
});

describe("describeFilesError", () => {
  const codes: FilesErrorCode[] = [
    "GIT_NOT_FOUND",
    "NOT_A_REPOSITORY",
    "TIMEOUT",
    "OUTPUT_TOO_LARGE",
    "FILE_NOT_FOUND",
    "NOT_A_FILE",
    "OUTSIDE_ROOT",
    "BINARY",
    "TOO_LARGE",
    "WRITE_FAILED",
  ];

  it.each(codes)("%s — русский текст без путей и stderr", (code) => {
    const text = describeFilesError(new FilesError(code));
    expect(text).toMatch(/[А-Яа-я]/);
    expect(text).not.toContain("/");
  });

  it("FAILED называет код завершения, чужая ошибка — общий текст", () => {
    expect(describeFilesError(new FilesError("FAILED", 128))).toBe("git завершился с ошибкой (код 128).");
    expect(describeFilesError(new FilesError("FAILED"))).toBe("git завершился с ошибкой (код неизвестен).");
    expect(describeFilesError(new Error("secret /Users/x"))).toBe("Не удалось выполнить операцию с файлом.");
  });
});
