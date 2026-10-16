import { describe, expect, it, vi } from "vitest";
import type { ToolResult } from "../../../core/index.ts";
import { createEditProposals, EDIT_TOOL_NAME, MAX_EDITED_FILES } from "../index.ts";

const ok = (content: string): ToolResult => ({ content, isError: false });
const FILES: Record<string, string> = {
  "README.md": "# Лимиты\n\nMAX_FILE_MB: 10\nMAX_FILES: 20\n",
  "docs/a.md": "повтор повтор\n",
};

function setup(files: Record<string, string> = FILES) {
  const read = vi.fn(async (path: string): Promise<ToolResult> => {
    const content = files[path];
    return content === undefined ? { content: "Файл не найден.", isError: true } : ok(content);
  });
  const onProposal = vi.fn();
  const proposals = createEditProposals({ read, onProposal });
  const propose = (args: Record<string, unknown>) =>
    proposals.source.callTool({ name: EDIT_TOOL_NAME, arguments: args });
  return { proposals, propose, read, onProposal };
}

describe("propose_edit", () => {
  it("объявляет один инструмент со схемой path, old, new", async () => {
    const [tool, ...rest] = await setup().proposals.source.listTools();
    expect(rest).toEqual([]);
    expect(tool).toMatchObject({
      name: "propose_edit",
      inputSchema: { required: ["path", "old", "new"], additionalProperties: false },
    });
    expect(tool?.description).toContain("только после подтверждения человека");
  });

  it("принятая правка копится в памяти; файл не читается повторно", async () => {
    const { proposals, propose, read, onProposal } = setup();
    const result = await propose({ path: "README.md", old: "MAX_FILE_MB: 10", new: "MAX_FILE_MB: 25" });
    expect(result).toEqual({
      content: "Правка принята для README.md; файл будет изменён только после подтверждения человека.",
      isError: false,
    });
    expect(proposals.changes()).toEqual([
      {
        path: "README.md",
        before: FILES["README.md"],
        after: "# Лимиты\n\nMAX_FILE_MB: 25\nMAX_FILES: 20\n",
        edits: 1,
      },
    ]);
    expect(read).toHaveBeenCalledWith("README.md");
    expect(onProposal).toHaveBeenCalledWith("README.md", true);
  });

  it("две правки одного файла применяются последовательно: before от первого чтения, after — итог", async () => {
    const { proposals, propose, read } = setup();
    await propose({ path: "README.md", old: "MAX_FILE_MB: 10", new: "MAX_FILE_MB: 25" });
    await propose({ path: "README.md", old: "MAX_FILE_MB: 25\n", new: "MAX_FILE_MB: 25\nMAX_PARALLEL: 4\n" });
    expect(read).toHaveBeenCalledTimes(1);
    expect(proposals.changes()).toMatchObject([
      { before: FILES["README.md"], after: "# Лимиты\n\nMAX_FILE_MB: 25\nMAX_PARALLEL: 4\nMAX_FILES: 20\n", edits: 2 },
    ]);
  });

  it("правки, вернувшие файл к исходному, в изменения не попадают", async () => {
    const { proposals, propose } = setup();
    await propose({ path: "README.md", old: "MAX_FILES: 20", new: "MAX_FILES: 30" });
    await propose({ path: "README.md", old: "MAX_FILES: 30", new: "MAX_FILES: 20" });
    expect(proposals.changes()).toEqual([]);
  });

  it("$-последовательности в new вставляются как текст", async () => {
    const { proposals, propose } = setup();
    await propose({ path: "README.md", old: "MAX_FILES: 20", new: "$& $1 $$" });
    expect(proposals.changes()[0]?.after).toContain("$& $1 $$");
  });

  it("путь ./README.md приводится к README.md", async () => {
    const { proposals, propose, read } = setup();
    await propose({ path: "./README.md", old: "MAX_FILES: 20", new: "MAX_FILES: 30" });
    expect(read).toHaveBeenCalledWith("README.md");
    expect(proposals.changes()[0]?.path).toBe("README.md");
  });

  it.each([
    ["фрагмент не найден", { path: "README.md", old: "нет такого", new: "x" }, "Фрагмент old не найден в README.md."],
    [
      "несколько вхождений",
      { path: "docs/a.md", old: "повтор", new: "x" },
      "Фрагмент old встречается 2 раз — расширьте его, чтобы он был уникальным.",
    ],
    [
      "не .md",
      { path: "src/a.ts", old: "a", new: "b" },
      "Путь должен быть относительным, без «..», и указывать на файл .md.",
    ],
    [
      "выход за корень",
      { path: "../x.md", old: "a", new: "b" },
      "Путь должен быть относительным, без «..», и указывать на файл .md.",
    ],
    [
      "абсолютный путь",
      { path: "/etc/x.md", old: "a", new: "b" },
      "Путь должен быть относительным, без «..», и указывать на файл .md.",
    ],
    ["пустой old", { path: "README.md", old: "", new: "b" }, "Фрагмент old не может быть пустым."],
    [
      "old равен new",
      { path: "README.md", old: "a", new: "a" },
      "Фрагмент new совпадает с old: правка ничего не меняет.",
    ],
    ["аргумент не строка", { path: "README.md", old: 1, new: "b" }, "Аргументы path, old и new должны быть строками."],
    ["ошибка чтения", { path: "нет.md", old: "a", new: "b" }, "Файл не найден."],
  ])("%s — isError с причиной, onProposal(false), правок нет", async (_name, args, message) => {
    const { proposals, propose, onProposal } = setup();
    expect(await propose(args)).toEqual({ content: message, isError: true });
    expect(onProposal).toHaveBeenCalledWith(typeof args.path === "string" ? args.path : "?", false);
    expect(proposals.changes()).toEqual([]);
  });

  it("лимит файлов: одиннадцатый файл отклоняется, правки уже принятых файлов продолжаются", async () => {
    const files = Object.fromEntries(
      Array.from({ length: MAX_EDITED_FILES + 1 }, (_, index) => [`f${index}.md`, "a\n"]),
    );
    const { proposals, propose } = setup(files);
    for (let index = 0; index < MAX_EDITED_FILES; index++) {
      expect((await propose({ path: `f${index}.md`, old: "a", new: "b" })).isError).toBe(false);
    }
    const rejected = await propose({ path: `f${MAX_EDITED_FILES}.md`, old: "a", new: "b" });
    expect(rejected).toEqual({ content: `Можно править не больше ${MAX_EDITED_FILES} файлов за раз.`, isError: true });
    expect((await propose({ path: "f0.md", old: "b", new: "c" })).isError).toBe(false);
    expect(proposals.changes()).toHaveLength(MAX_EDITED_FILES);
  });

  it("вызов другого инструмента — исключение", async () => {
    const { proposals } = setup();
    await expect(proposals.source.callTool({ name: "other", arguments: {} })).rejects.toThrow("Неизвестный");
  });
});
