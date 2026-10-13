import { readFileSync } from "node:fs";
import type { CliView } from "../adapters/cli/index.ts";
import { Agent } from "../core/index.ts";
import type { StdioToolSourceOptions } from "../features/mcp/index.ts";
import type { ResolvedConfig } from "./config.ts";
import { type CreateModel, createConfiguredModel } from "./model.ts";
import { combineToolSources, type WithToolSource, withSessions } from "./toolSources.ts";

/** Лимит вызовов инструментов за реплику `ask`; держит Agent. */
export const ASK_MAX_TOOL_CALLS = 6;

/** Серверы, сессии которых `ask` открывает на каждую реплику. */
export type McpServers = (config: ResolvedConfig) => readonly StdioToolSourceOptions[];

export type AskHandlerOptions = Readonly<{
  createModel: CreateModel;
  getConfig: () => ResolvedConfig;
  view: Pick<CliView, "mcpToolStatus">;
  servers: McpServers;
  withToolSource: WithToolSource;
}>;

export function systemPrompt(): string {
  return readFileSync(new URL("./system.md", import.meta.url), "utf8").trim();
}

/** Реплика без поиска по документам и без истории; модель создаётся до запуска MCP-серверов. */
export function createAskHandler(options: AskHandlerOptions): (text: string) => Promise<string> {
  return (text) => {
    const config = options.getConfig();
    const agent = new Agent(createConfiguredModel(config, options.createModel), systemPrompt(), {
      maxToolCalls: ASK_MAX_TOOL_CALLS,
    });
    return withSessions(options.servers(config), options.withToolSource, options.view, (sources) =>
      agent.respond(text, { tools: combineToolSources(sources) }),
    );
  };
}
