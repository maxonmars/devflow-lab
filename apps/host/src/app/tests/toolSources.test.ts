import { describe, expect, it, vi } from "vitest";
import type { ToolSource } from "../../core/index.ts";
import { combineToolSources, observedToolSource, withoutTools } from "../toolSources.ts";

function source(names: string[], answer: string): ToolSource & { callTool: ReturnType<typeof vi.fn> } {
  return {
    listTools: async () => names.map((name) => ({ name, inputSchema: { type: "object" } })),
    callTool: vi.fn(async () => ({ content: answer, isError: false })),
  };
}

describe("combineToolSources", () => {
  it("объединяет инструменты в порядке источников и направляет вызов по имени", async () => {
    const git = source(["git_branch"], "main");
    const files = source(["list_files", "read_file"], "README.md");
    const combined = combineToolSources([git, files]);
    expect((await combined.listTools()).map((tool) => tool.name)).toEqual(["git_branch", "list_files", "read_file"]);
    expect(await combined.callTool({ name: "list_files", arguments: { dir: "docs" } })).toEqual({
      content: "README.md",
      isError: false,
    });
    expect(files.callTool).toHaveBeenCalledWith({ name: "list_files", arguments: { dir: "docs" } });
    expect(git.callTool).not.toHaveBeenCalled();
  });

  it("одинаковое имя у двух серверов — ошибка, а не молчаливое перекрытие", async () => {
    const combined = combineToolSources([source(["dup"], "a"), source(["dup"], "b")]);
    await expect(combined.listTools()).rejects.toThrow("одним именем");
  });

  it("вызов неизвестного инструмента не уходит ни в один источник", async () => {
    const one = source(["a"], "x");
    const combined = combineToolSources([one]);
    await combined.listTools();
    expect(() => combined.callTool({ name: "b", arguments: {} })).toThrow("не входит");
    expect(one.callTool).not.toHaveBeenCalled();
  });

  it("без источников список инструментов пуст", async () => {
    expect(await combineToolSources([]).listTools()).toEqual([]);
  });
});

describe("observedToolSource", () => {
  it("сообщает об успехе, isError и исключении; исключение проходит наружу", async () => {
    const statuses: string[] = [];
    const view = {
      mcpToolStatus: (server: string, tool: string, ok: boolean) => statuses.push(`${server}:${tool}:${ok}`),
    };
    const inner = source(["git_branch"], "main");
    const observed = observedToolSource(inner, view, "git");
    expect(await observed.listTools()).toHaveLength(1);
    await observed.callTool({ name: "git_branch", arguments: {} });
    inner.callTool.mockResolvedValueOnce({ content: "нет репозитория", isError: true });
    await observed.callTool({ name: "git_branch", arguments: {} });
    inner.callTool.mockRejectedValueOnce(new Error("сбой"));
    await expect(observed.callTool({ name: "git_branch", arguments: {} })).rejects.toThrow("сбой");
    expect(statuses).toEqual(["git:git_branch:true", "git:git_branch:false", "git:git_branch:false"]);
  });
});

describe("withoutTools", () => {
  it("скрывает указанные инструменты из списка, остальные вызываются как раньше", async () => {
    const inner = source(["read_file", "list_files"], "ok");
    const visible = withoutTools(inner, ["read_file"]);
    expect((await visible.listTools()).map((tool) => tool.name)).toEqual(["list_files"]);
    await visible.callTool({ name: "list_files", arguments: {} });
    expect(inner.callTool).toHaveBeenCalledWith({ name: "list_files", arguments: {} });
  });

  it("вызов скрытого инструмента не доходит до источника", () => {
    const inner = source(["read_file"], "ok");
    expect(() => withoutTools(inner, ["read_file"]).callTool({ name: "read_file", arguments: {} })).toThrow("скрыт");
    expect(inner.callTool).not.toHaveBeenCalled();
  });

  it("исходный источник список не теряет", async () => {
    const inner = source(["read_file"], "ok");
    withoutTools(inner, ["read_file"]);
    expect(await inner.listTools()).toHaveLength(1);
  });
});
