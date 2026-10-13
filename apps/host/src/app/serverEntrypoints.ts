import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StdioToolSourceOptions } from "../features/mcp/index.ts";
import type { ResolvedConfig } from "./config.ts";

const APP_DIR = dirname(fileURLToPath(import.meta.url));

/** Метки серверов для строк `MCP:` и ошибок McpToolSourceError. */
export const SERVER_NAMES = { git: "git" } as const;

/** hostModuleUrl — import.meta.url модуля host; .js означает собранный запуск, .ts — исходный. */
export function resolveServerEntrypoint(hostModuleUrl: string, workspace: string): string {
  const relative = hostModuleUrl.endsWith(".js") ? `${workspace}/dist/app/main.js` : `${workspace}/src/app/main.ts`;
  return resolve(APP_DIR, "../../../../servers", relative);
}

/** Git-сервер с корнем `project.root`; запускается тем же Node, что и host. */
export function gitServer(config: ResolvedConfig, cwd: string, nodeExecutable: string): StdioToolSourceOptions {
  return {
    command: nodeExecutable,
    args: [resolveServerEntrypoint(import.meta.url, "git"), "--root", resolve(cwd, config.values["project.root"])],
    serverName: SERVER_NAMES.git,
    timeoutMs: config.values["mcp.timeoutMs"],
  };
}
