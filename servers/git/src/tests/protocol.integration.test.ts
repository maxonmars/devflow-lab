import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { type StdioServerHandle, serveStdio } from "@modelcontextprotocol/server/stdio";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGitServer, GIT_TOOL_NAMES } from "../index.ts";
import { runnerFor, tempRepository, writeFiles } from "./support.ts";

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

async function connect(projectRoot = root): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  handle = serveStdio(() => createGitServer({ runGit: runnerFor(projectRoot) }), { transport: serverTransport });
  const created = new Client({ name: "test-client", version: "0.0.0" }, { versionNegotiation: { mode: "auto" } });
  await created.connect(clientTransport);
  client = created;
  return created;
}

const textOf = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  (result.content as { type: string; text: string }[]).map((block) => block.text).join("\n");

describe("git MCP server: протокольная интеграция", () => {
  it("современная ревизия, четыре читающих инструмента со схемами", async () => {
    const created = await connect();
    expect(created.getProtocolEra()).toBe("modern");
    const { tools } = await created.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(Object.values(GIT_TOOL_NAMES));
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(tool.description).toBeTruthy();
    }
    const diff = tools.find((tool) => tool.name === GIT_TOOL_NAMES.diff);
    expect(diff?.inputSchema).toMatchObject({ properties: { staged: { type: "boolean" }, path: { type: "string" } } });
  });

  it("git_branch и list_files возвращают text и structuredContent", async () => {
    const created = await connect();
    const branch = await created.callTool({ name: GIT_TOOL_NAMES.branch, arguments: {} });
    expect(branch.isError).not.toBe(true);
    expect(textOf(branch)).toMatch(/^Ветка: main\nHEAD: [0-9a-f]+ Первый коммит$/);
    expect(branch.structuredContent).toMatchObject({ branch: "main" });
    const files = await created.callTool({ name: GIT_TOOL_NAMES.files, arguments: { path: "docs" } });
    expect(textOf(files)).toBe("Отслеживаемые файлы в docs (1):\ndocs/guide.md");
  });

  it("git_diff показывает изменение рабочей копии", async () => {
    writeFiles(root, { "README.md": "# Проект\n\nДобавлено\n" });
    const created = await connect();
    const result = await created.callTool({ name: GIT_TOOL_NAMES.diff, arguments: {} });
    expect(textOf(result)).toContain("+Добавлено");
  });

  it.each(["../secret", "/etc", "docs/../../x"])("путь %s за корнем отклоняется до запуска git", async (path) => {
    const created = await connect();
    const result = await created.callTool({ name: GIT_TOOL_NAMES.files, arguments: { path } });
    expect(result.isError).toBe(true);
  });

  it("каталог вне git-репозитория — isError с причиной, а не обрыв вызова", async () => {
    const outside = mkdtempSync(join(tmpdir(), "devflow-lab-git-plain-"));
    try {
      const created = await connect(outside);
      const result = await created.callTool({ name: GIT_TOOL_NAMES.status, arguments: {} });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toBe("Корень проекта не находится внутри git-репозитория.");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
