import {
  type CliView,
  describeError,
  type FileOutcome,
  InputError,
  isYes,
  readAnswer,
  type Terminal,
} from "../adapters/cli/index.ts";
import { Agent, type ToolSource } from "../core/index.ts";
import { createEditProposals, type FileChange, filesSystemPrompt, renderFilesResult } from "../features/files/index.ts";
import type { StdioToolSourceOptions } from "../features/mcp/index.ts";
import type { McpServers } from "./ask.ts";
import type { ResolvedConfig } from "./config.ts";
import { type CreateModel, createConfiguredModel } from "./model.ts";
import { combineToolSources, type WithToolSource, withoutTools, withSessions } from "./toolSources.ts";

/** Лимит вызовов инструментов за команду `files`; держит Agent. */
export const FILES_MAX_TOOL_CALLS = 15;

/** Имена инструментов files-сервера и git-сервера; host не импортирует серверы, поэтому они повторены здесь. */
export const FILES_TOOLS = { search: "files_search", read: "files_read", write: "files_write" } as const;
export const GIT_HEAD_READ_TOOL = "read_file";

export type FilesHandlerOptions = Readonly<{
  createModel: CreateModel;
  getConfig: () => ResolvedConfig;
  view: Pick<CliView, "mcpToolStatus" | "editProposal">;
  servers: McpServers;
  filesServer: (config: ResolvedConfig) => StdioToolSourceOptions;
  withToolSource: WithToolSource;
}>;

export type FilesPlan = Readonly<{ markdown: string; changes: readonly FileChange[] }>;
export type FilesHandler = Readonly<{
  plan: (goal: string) => Promise<FilesPlan>;
  apply: (changes: readonly FileChange[]) => Promise<readonly FileOutcome[]>;
}>;

async function requireFilesTools(source: ToolSource): Promise<void> {
  const names = new Set((await source.listTools()).map((tool) => tool.name));
  if (!Object.values(FILES_TOOLS).every((name) => names.has(name))) {
    throw new InputError(`MCP-сервер files не объявил инструменты ${Object.values(FILES_TOOLS).join(", ")}.`);
  }
}

/** Файл пишется, только если его содержимое всё ещё совпадает с тем, на которое строилась правка. */
async function applyChange(source: ToolSource, change: FileChange): Promise<FileOutcome> {
  const { path } = change;
  try {
    const current = await source.callTool({ name: FILES_TOOLS.read, arguments: { path } });
    if (current.isError) return { path, status: "failed", detail: current.content };
    if (current.content !== change.before) {
      return { path, status: "skipped", detail: "файл изменился после предложения правки" };
    }
    const written = await source.callTool({ name: FILES_TOOLS.write, arguments: { path, content: change.after } });
    return written.isError ? { path, status: "failed", detail: written.content } : { path, status: "written" };
  } catch (error) {
    return { path, status: "failed", detail: describeError(error) };
  }
}

/** `files <цель...>` в две фазы (ADR 0005): `plan` только предлагает правки, `apply` пишет подтверждённые человеком. */
export function createFilesHandler(options: FilesHandlerOptions): FilesHandler {
  const { view } = options;
  return {
    plan: async (goal) => {
      const config = options.getConfig();
      const agent = new Agent(createConfiguredModel(config, options.createModel), filesSystemPrompt(), {
        maxToolCalls: FILES_MAX_TOOL_CALLS,
      });
      const servers = [options.filesServer(config), ...options.servers(config)];
      return withSessions(servers, options.withToolSource, view, async ([files, ...git]) => {
        await requireFilesTools(files);
        const proposals = createEditProposals({
          read: (path) => files.callTool({ name: FILES_TOOLS.read, arguments: { path } }),
          onProposal: (path, accepted) => view.editProposal(path, accepted),
        });
        const tools = combineToolSources([
          withoutTools(files, [FILES_TOOLS.write]),
          ...git.map((source) => withoutTools(source, [GIT_HEAD_READ_TOOL])),
          proposals.source,
        ]);
        const answer = await agent.respond(goal, { tools });
        const changes = proposals.changes();
        return { markdown: renderFilesResult(answer, changes), changes };
      });
    },
    apply: (changes) =>
      withSessions([options.filesServer(options.getConfig())], options.withToolSource, view, async ([files]) => {
        const outcomes: FileOutcome[] = [];
        for (const change of changes) outcomes.push(await applyChange(files, change));
        return outcomes;
      }),
  };
}

/** Вопрос `[y/N]` только когда `files` запущена одной командой в терминале: в REPL stdin занят readline. */
export function createConfirm(
  terminal: Terminal,
  view: Pick<CliView, "confirmPrompt">,
  repl: () => boolean,
): (question: string) => Promise<"yes" | "no" | "unavailable"> {
  return async (question) => {
    if (repl() || !terminal.interactive) return "unavailable";
    view.confirmPrompt(question);
    return isYes(await readAnswer(terminal.input)) ? "yes" : "no";
  };
}
