import { CliView, createLineReader, runCli, type Terminal } from "../adapters/cli/index.ts";
import { DeepSeekModel, LocalModel } from "../adapters/llm/index.ts";
import { withStdioToolSource } from "../features/mcp/index.ts";
import { createAskHandler, type McpServers } from "./ask.ts";
import { createCommands } from "./commands.ts";
import { parseOptions, type ResolvedConfig, resolveConfig, showConfig } from "./config.ts";
import type { CreateEmbeddings } from "./embeddings.ts";
import { createConfirm, createFilesHandler } from "./files.ts";
import { createProjectInfoHandler } from "./info.ts";
import { type CreateModel, type ModelOptions, modelLabel } from "./model.ts";
import { createRagHandlers } from "./rag.ts";
import { createRagAnswerHandlers } from "./ragAnswer.ts";
import { createReviewHandler } from "./review.ts";
import { filesServer, gitServer, supportServer } from "./serverEntrypoints.ts";
import { createSupportHandler } from "./support.ts";
import type { WithToolSource } from "./toolSources.ts";

export type RunOptions = Readonly<{
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  terminal: Terminal;
  createModel?: CreateModel;
  createEmbeddings?: CreateEmbeddings;
  /** Node для запуска MCP-серверов; main.ts передаёт process.execPath. */
  nodeExecutable: string;
  /** MCP-серверы для `ask`, `info` и `review`; по умолчанию — git-сервер с корнем `project.root`. */
  mcpServers?: McpServers;
  withToolSource?: WithToolSource;
}>;

function defaultCreateModel(options: ModelOptions) {
  return options.provider === "local" ? new LocalModel(options) : new DeepSeekModel(options);
}

export async function run(options: RunOptions): Promise<number> {
  let config: ResolvedConfig;
  const reader = createLineReader(options.terminal.input);
  const view = new CliView(options.terminal.output, options.terminal.error);
  const getConfig = () => config;
  const createModel = options.createModel ?? defaultCreateModel;
  const { cwd, createEmbeddings } = options;
  const rag = createRagHandlers({ cwd, getConfig, view, createEmbeddings });
  const ragAnswer = createRagAnswerHandlers({ cwd, getConfig, createModel, createEmbeddings, view });
  const servers =
    options.mcpServers ?? ((current: ResolvedConfig) => [gitServer(current, cwd, options.nodeExecutable)]);
  const withToolSource = options.withToolSource ?? withStdioToolSource;
  const projectOptions = { cwd, getConfig, createModel, createEmbeddings, view, servers, withToolSource };
  const commands = createCommands({
    ask: createAskHandler({ createModel, getConfig, view, servers, withToolSource }),
    modelLabel: () => modelLabel(config),
    config: () => showConfig(config),
    ragIndex: rag.index,
    ragAsk: ragAnswer.ask,
    projectInfo: createProjectInfoHandler(projectOptions),
    review: createReviewHandler(projectOptions),
    support: createSupportHandler({
      cwd,
      getConfig,
      createModel,
      createEmbeddings,
      view,
      withToolSource,
      server: (current) => supportServer(current, cwd, options.nodeExecutable),
    }),
    files: createFilesHandler({
      ...projectOptions,
      filesServer: (current) => filesServer(current, cwd, options.nodeExecutable),
    }),
    confirm: createConfirm(options.terminal, view, reader),
    view,
  });
  let command: string[];
  try {
    const parsed = parseOptions(
      options.argv,
      commands.flatMap((item) => item.aliases ?? []),
    );
    command = parsed.command;
    config = resolveConfig(parsed.flags, options.env, options.cwd);
  } catch (error) {
    view.error(error);
    return 1;
  }
  return runCli(commands, command, options.terminal, view, modelLabel(config), reader);
}
