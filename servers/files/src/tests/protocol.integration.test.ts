import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { type StdioServerHandle, serveStdio } from "@modelcontextprotocol/server/stdio";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFilesServer, FILES_TOOL_NAMES } from "../index.ts";
import { contextFor, tempRepository } from "./support.ts";

let root: string;
let client: Client | undefined;
let handle: StdioServerHandle | undefined;

beforeEach(() => {
  root = tempRepository();
});
afterEach(async () => {
  await client?.close();
  await handle?.close();
  client = undefined;
  handle = undefined;
  rmSync(root, { recursive: true, force: true });
});

async function connect(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  handle = serveStdio(() => createFilesServer(contextFor(root)), { transport: serverTransport });
  const created = new Client({ name: "test-client", version: "0.0.0" }, { versionNegotiation: { mode: "auto" } });
  await created.connect(clientTransport);
  client = created;
  return created;
}

const textOf = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  (result.content as { type: string; text: string }[]).map((block) => block.text).join("\n");

describe("files MCP server: протокольная интеграция", () => {
  it("три инструмента; destructiveHint только у files_write", async () => {
    const created = await connect();
    const { tools } = await created.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(Object.values(FILES_TOOL_NAMES).sort());
    for (const tool of tools) {
      const write = tool.name === FILES_TOOL_NAMES.write;
      expect(tool.annotations).toMatchObject({ readOnlyHint: !write, destructiveHint: write });
      expect(tool.description).toBeTruthy();
    }
    expect(tools.find((tool) => tool.name === FILES_TOOL_NAMES.write)?.inputSchema).toMatchObject({
      required: ["path", "content"],
    });
  });

  it("files_search и files_read отвечают текстом", async () => {
    const created = await connect();
    const found = await created.callTool({ name: FILES_TOOL_NAMES.search, arguments: { query: "withSessions" } });
    expect(textOf(found)).toBe(
      [
        "Совпадения «withSessions» (3):",
        "README.md:3: withSessions описан здесь.",
        "docs/guide.md:3: withSessions открывает сессии.",
        "src/code.ts:1: export const withSessions = 1;",
      ].join("\n"),
    );
    const file = await created.callTool({ name: FILES_TOOL_NAMES.read, arguments: { path: "docs/guide.md" } });
    expect(textOf(file)).toBe("# Гайд\n\nwithSessions открывает сессии.\n");
  });

  it("files_write заменяет файл и отвечает «Записан файл»", async () => {
    const created = await connect();
    const result = await created.callTool({
      name: FILES_TOOL_NAMES.write,
      arguments: { path: "README.md", content: "# Новый\n" },
    });
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toBe("Записан файл README.md.");
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("# Новый\n");
  });

  it.each([
    ["src/code.ts", "не .md"],
    ["README.MD", "расширение другого регистра"],
    [".git/config.md", "каталог .git"],
    ["../x.md", "выход за корень"],
    ["/etc/x.md", "абсолютный путь"],
  ])("files_write отклоняет %s (%s) на уровне схемы", async (path) => {
    const created = await connect();
    const result = await created.callTool({ name: FILES_TOOL_NAMES.write, arguments: { path, content: "x" } });
    expect(result.isError).toBe(true);
    expect(readFileSync(join(root, "src/code.ts"), "utf8")).toBe("export const withSessions = 1;\n");
  });

  it.each([FILES_TOOL_NAMES.read, FILES_TOOL_NAMES.search])("%s: путь с .. — isError", async (name) => {
    const created = await connect();
    const args = name === FILES_TOOL_NAMES.read ? { path: "../secret" } : { query: "x", path: "docs/../../x" };
    expect((await created.callTool({ name, arguments: args })).isError).toBe(true);
  });

  it("ошибка файла — isError с причиной, без путей файловой системы", async () => {
    const created = await connect();
    const result = await created.callTool({ name: FILES_TOOL_NAMES.read, arguments: { path: "нет.md" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Файл не найден");
    expect(textOf(result)).not.toContain(root);
  });
});
