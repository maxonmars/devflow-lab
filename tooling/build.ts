import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { files, localPath, workspacePaths } from "./files.ts";

const TOOL_LIST_SMOKE_TIMEOUT_MS = 5_000;
const GIT_TOOLS = ["git_branch", "git_changed_files", "git_diff", "git_status", "list_files", "read_file"];
const SUPPORT_TOOLS = ["get_ticket"];

/** Собранный сервер из другого каталога: сверяет отсортированный listTools с ожидаемым набором инструментов. */
async function toolListSmoke(cwd: string, args: readonly string[], expectedTools: readonly string[]): Promise<void> {
  const client = new Client({ name: "build-smoke", version: "0.0.0" }, { versionNegotiation: { mode: "auto" } });
  const transport = new StdioClientTransport({ command: process.execPath, args: [...args], cwd, stderr: "ignore" });
  await client.connect(transport, { timeout: TOOL_LIST_SMOKE_TIMEOUT_MS });
  try {
    const listed = (await client.listTools()).tools.map((tool) => tool.name).sort();
    if (listed.join() !== [...expectedTools].sort().join())
      throw new Error(`${args[0]} smoke: неверный список инструментов.`);
  } finally {
    await client.close();
  }
}

const root = resolve(".");
for (const workspace of workspacePaths(root)) {
  rmSync(join(workspace, "dist"), { recursive: true, force: true });
  execFileSync(
    process.execPath,
    [join(root, "node_modules/typescript/bin/tsc"), "-p", join(workspace, "tsconfig.build.json")],
    { stdio: "inherit" },
  );
  for (const path of files(join(workspace, "src")).filter((path) => path.endsWith(".md"))) {
    const target = join(workspace, "dist", localPath(join(workspace, "src"), path));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(path, target);
  }
}

const temporary = mkdtempSync(join(tmpdir(), "devflow-lab-build-"));
try {
  const main = join(root, "apps/host/dist/app/main.js");
  const help = execFileSync(process.execPath, [main, "help"], {
    cwd: temporary,
    encoding: "utf8",
    env: {},
    stdio: "pipe",
  });
  for (const name of ["info", "support", "review", "rag index", "rag ask", "config show"]) {
    if (!help.includes(name)) throw new Error(`В собранной справке отсутствует ${name}.`);
  }
  execFileSync(process.execPath, [main, "config", "show"], { cwd: temporary, env: {}, stdio: "pipe" });
  console.log("Сборка и запуск CLI из другого каталога: OK.");
  await toolListSmoke(temporary, [join(root, "servers/git/dist/app/main.js"), "--root", root], GIT_TOOLS);
  console.log("Запуск собранного git MCP server из другого каталога: OK.");
  const supportData = join(root, "examples/support-product/support/tickets.json");
  await toolListSmoke(
    temporary,
    [join(root, "servers/support/dist/app/main.js"), "--data", supportData],
    SUPPORT_TOOLS,
  );
  console.log("Запуск собранного support MCP server из другого каталога: OK.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
