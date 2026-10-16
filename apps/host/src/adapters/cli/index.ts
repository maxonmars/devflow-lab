import type { Readable, Writable } from "node:stream";
import { type Command, dispatch, replArguments } from "./commands.ts";
import type { LineReader } from "./confirm.ts";
import type { CliView } from "./view.ts";

export { type Command, dispatch, replArguments } from "./commands.ts";
export { createLineReader, isYes, type LineReader } from "./confirm.ts";
export { describeError, InputError } from "./errors.ts";
export { CliView, type CommandView, type ConfigRow, type FileOutcome, type HelpSetting } from "./view.ts";

export type Terminal = Readonly<{
  input: Readable;
  output: Writable;
  error: Writable;
  interactive: boolean;
}>;

export async function runCli(
  commands: readonly Command[],
  argv: readonly string[],
  terminal: Terminal,
  view: CliView,
  model: string,
  reader: LineReader,
): Promise<number> {
  if (argv.length > 0) {
    try {
      await dispatch(commands, argv);
      return 0;
    } catch (error) {
      view.error(error);
      return 1;
    } finally {
      reader.close();
    }
  }
  let exitCode = 0;
  try {
    if (terminal.interactive) {
      view.banner(commands, model);
      view.prompt();
    }
    for await (const line of reader.lines()) {
      if (line.trim()) {
        try {
          if ((await dispatch(commands, replArguments(line))) === "exit") break;
        } catch (error) {
          view.error(error);
          exitCode = 1;
        }
      }
      if (terminal.interactive) view.prompt();
    }
  } finally {
    reader.close();
  }
  return exitCode;
}
