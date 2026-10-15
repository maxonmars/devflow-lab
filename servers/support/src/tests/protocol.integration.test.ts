import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { type StdioServerHandle, serveStdio } from "@modelcontextprotocol/server/stdio";
import { afterEach, describe, expect, it } from "vitest";
import { createSupportServer, type ReadData, SUPPORT_TOOL_NAMES } from "../index.ts";
import { DATA, readJson } from "./fixtures.ts";

let client: Client | undefined;
let handle: StdioServerHandle | undefined;

afterEach(async () => {
  await client?.close();
  await handle?.close();
  client = undefined;
  handle = undefined;
});

async function connect(readData: ReadData = readJson(DATA)): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  handle = serveStdio(() => createSupportServer({ readData }), { transport: serverTransport });
  const created = new Client({ name: "test-client", version: "0.0.0" }, { versionNegotiation: { mode: "auto" } });
  await created.connect(clientTransport);
  client = created;
  return created;
}

const textOf = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  (result.content as { type: string; text: string }[]).map((block) => block.text).join("\n");

describe("support MCP server: протокольная интеграция", () => {
  it("один читающий инструмент get_ticket с обязательным id", async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((tool) => tool.name)).toEqual([SUPPORT_TOOL_NAMES.ticket]);
    expect(tools[0]?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(tools[0]?.inputSchema).toMatchObject({ properties: { id: { type: "string" } }, required: ["id"] });
    expect(tools[0]?.outputSchema).toBeTruthy();
  });

  it("текст тикета содержит тему и статус аккаунта клиента, structuredContent — тикет и клиента", async () => {
    const result = await (await connect()).callTool({ name: SUPPORT_TOOL_NAMES.ticket, arguments: { id: "T-1" } });
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toContain("Тикет T-1: Не могу войти");
    expect(textOf(result)).toContain("Статус аккаунта: временно заблокирован (locked)");
    expect(result.structuredContent).toMatchObject({ user: { id: "u-1" }, messagesShown: 2, messagesTotal: 2 });
  });

  it("неизвестный тикет — isError с причиной", async () => {
    const result = await (await connect()).callTool({ name: SUPPORT_TOOL_NAMES.ticket, arguments: { id: "T-9999" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Тикет с таким идентификатором не найден.");
  });

  it.each(["", "../x", "a b"])("id «%s» отклоняет схема до чтения данных", async (id) => {
    let reads = 0;
    const created = await connect(async () => {
      reads += 1;
      return JSON.stringify(DATA);
    });
    const result = await created.callTool({ name: SUPPORT_TOOL_NAMES.ticket, arguments: { id } });
    expect(result.isError).toBe(true);
    expect(reads).toBe(0);
  });

  it("нечитаемые данные — isError с причиной, без пути файла", async () => {
    const created = await connect(async () => {
      throw new Error("ENOENT: /secret/tickets.json");
    });
    const result = await created.callTool({ name: SUPPORT_TOOL_NAMES.ticket, arguments: { id: "T-1" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Файл данных поддержки не прочитан.");
  });
});
