import type { Command, CommandView, ConfigRow } from "../adapters/cli/index.ts";
import { sections } from "./markdown.ts";
import type { RagOutcome } from "./rag.ts";
import type { RagReply } from "./ragAnswer.ts";
import { settingEntries } from "./settings.ts";

const descriptions = sections(new URL("./commands.md", import.meta.url));

type CommandContext = {
  ask: (text: string) => Promise<string>;
  modelLabel: () => string;
  config: () => readonly ConfigRow[];
  ragIndex: () => Promise<RagOutcome>;
  ragAsk: (text: string) => Promise<RagReply>;
  projectInfo: (text: string) => Promise<RagReply>;
  review: (base: string) => Promise<string>;
  view: CommandView;
};

function ragCommands(context: CommandContext): Command[] {
  return [
    {
      name: "rag index",
      arguments: [],
      description: descriptions["rag index"] ?? "",
      run: async () => {
        const outcome = await context.ragIndex();
        context.view.indexBuilt(outcome.lines, outcome.path);
        return "continue";
      },
    },
    {
      name: "rag ask",
      arguments: ["<текст...>"],
      description: descriptions["rag ask"] ?? "",
      run: async (args) => {
        const reply = await context.ragAsk(args.join(" "));
        context.view.ragAnswer(reply.answer, reply.fragments, context.modelLabel());
        return "continue";
      },
    },
  ];
}

function askCommand(context: CommandContext): Command {
  return {
    name: "ask",
    arguments: ["<текст...>"],
    description: descriptions.ask ?? "",
    run: async (args) => {
      context.view.answer(await context.ask(args.join(" ")), context.modelLabel());
      return "continue";
    },
  };
}

export function createCommands(context: CommandContext): readonly Command[] {
  const commands: Command[] = [
    askCommand(context),
    {
      name: "info",
      arguments: ["<вопрос...>"],
      missingArgument: "Не указан вопрос о проекте.",
      description: descriptions.info ?? "",
      run: async (args) => {
        const reply = await context.projectInfo(args.join(" "));
        context.view.infoAnswer(reply.answer, reply.fragments, context.modelLabel());
        return "continue";
      },
    },
    {
      name: "help",
      arguments: [],
      aliases: ["--help", "-h"],
      description: descriptions.help ?? "",
      run: async () => {
        context.view.help(
          commands,
          settingEntries.filter((entry) => !entry.secret),
        );
        return "continue";
      },
    },
    {
      name: "config show",
      arguments: [],
      description: descriptions["config show"] ?? "",
      run: async () => {
        context.view.config(context.config());
        return "continue";
      },
    },
    ...ragCommands(context),
    {
      name: "review",
      arguments: ["<база>"],
      missingArgument: "Не указана базовая ветка или коммит для ревью.",
      description: descriptions.review ?? "",
      run: async (args) => {
        context.view.review(await context.review(args.join(" ")), context.modelLabel());
        return "continue";
      },
    },
    {
      name: "exit",
      arguments: [],
      description: descriptions.exit ?? "",
      run: async () => "exit",
    },
  ];
  return commands;
}
