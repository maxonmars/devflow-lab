import { type CliView, InputError } from "../adapters/cli/index.ts";
import type { JsonObject, ToolDefinition, ToolSource } from "../core/index.ts";
import type { StdioToolSourceOptions } from "../features/mcp/index.ts";

/** Открывает MCP-сессию на время `use`; реализация по умолчанию — `withStdioToolSource`, в тестах — подмена. */
export type WithToolSource = <T>(
  options: StdioToolSourceOptions,
  use: (source: ToolSource) => Promise<T>,
) => Promise<T>;

type ToolStatusView = Pick<CliView, "mcpToolStatus">;

/** Объединяет источники в один ToolSource; вызов направляется по имени инструмента. */
export function combineToolSources(sources: readonly ToolSource[]): ToolSource {
  const owners = new Map<string, ToolSource>();
  return {
    listTools: async () => {
      const lists = await Promise.all(sources.map(async (source) => ({ source, tools: await source.listTools() })));
      owners.clear();
      const all: ToolDefinition[] = [];
      for (const { source, tools } of lists) {
        for (const tool of tools) {
          if (owners.has(tool.name)) throw new Error("Два MCP-сервера объявили инструмент с одним именем.");
          owners.set(tool.name, source);
          all.push(tool);
        }
      }
      return all;
    },
    callTool: (invocation) => {
      const owner = owners.get(invocation.name);
      if (!owner) throw new Error("Инструмент не входит ни в один источник.");
      return owner.callTool(invocation);
    },
  };
}

/** Строка `MCP: …` на каждый реальный вызов MCP-инструмента этого источника. */
export function observedToolSource(source: ToolSource, view: ToolStatusView, serverName: string): ToolSource {
  return {
    listTools: () => source.listTools(),
    callTool: async (invocation) => {
      try {
        const result = await source.callTool(invocation);
        view.mcpToolStatus(serverName, invocation.name, !result.isError);
        return result;
      } catch (error) {
        view.mcpToolStatus(serverName, invocation.name, false);
        throw error;
      }
    },
  };
}

/** Открывает сессии по одной, вложенно: каждая закрывается в finally своего `open`. */
export function withSessions<T>(
  servers: readonly StdioToolSourceOptions[],
  open: WithToolSource,
  view: ToolStatusView,
  use: (sources: readonly ToolSource[]) => Promise<T>,
  opened: readonly ToolSource[] = [],
): Promise<T> {
  const [next, ...rest] = servers;
  if (!next) return use(opened);
  return open(next, (source) =>
    withSessions(rest, open, view, use, [...opened, observedToolSource(source, view, next.serverName)]),
  );
}

/** Текст результата инструмента; `isError` — InputError с текстом сервера: причину формулирует сервер или схема. */
export async function callText(source: ToolSource, name: string, args: JsonObject): Promise<string> {
  const result = await source.callTool({ name, arguments: args });
  if (result.isError) throw new InputError(result.content);
  return result.content;
}
