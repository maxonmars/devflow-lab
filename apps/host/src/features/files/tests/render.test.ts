import { describe, expect, it } from "vitest";
import { filesSystemPrompt, renderFilesResult } from "../index.ts";

const change = (path: string, before: string, after: string) => ({ path, before, after, edits: 1 });

describe("renderFilesResult", () => {
  it("без правок возвращает ответ модели как есть", () => {
    expect(renderFilesResult("Найдено: a.ts:1 — вызов", [])).toBe("Найдено: a.ts:1 — вызов");
  });

  it("с правками добавляет раздел и unified diff в блоке diff", () => {
    const text = renderFilesResult("Предлагаю правку.\n", [change("README.md", "а\nMAX: 10\n", "а\nMAX: 25\n")]);
    expect(text).toBe(
      [
        "Предлагаю правку.",
        "",
        "## Предложенные изменения",
        "",
        "### README.md",
        "",
        "```diff",
        "--- a/README.md",
        "+++ b/README.md",
        "@@ -1,2 +1,2 @@",
        " а",
        "-MAX: 10",
        "+MAX: 25",
        "```",
      ].join("\n"),
    );
  });

  it("несколько файлов — по блоку на каждый", () => {
    const text = renderFilesResult("Ок", [change("a.md", "1\n", "2\n"), change("b.md", "3\n", "4\n")]);
    expect(text).toContain("### a.md");
    expect(text).toContain("### b.md");
    expect(text.match(/```diff/g)).toHaveLength(2);
  });

  it("забор длиннее серии обратных кавычек внутри файла", () => {
    const before = "```ts\nconst a = 1;\n```\n";
    const text = renderFilesResult("Ок", [change("a.md", before, before.replace("1", "2"))]);
    expect(text).toContain("````diff\n");
    expect(text.trimEnd().endsWith("\n````")).toBe(true);
    const longer = "`````\nx\n`````\n";
    expect(renderFilesResult("Ок", [change("a.md", longer, `${longer}y\n`)])).toContain("``````diff\n");
  });
});

describe("filesSystemPrompt", () => {
  it("читает prompts/files.md: инструменты и запрет обещать применённые правки", () => {
    const prompt = filesSystemPrompt();
    for (const name of ["files_search", "files_read", "propose_edit", "git_diff"]) expect(prompt).toContain(name);
    expect(prompt).toContain("Не утверждай, что файлы уже изменены");
  });
});
