import { describe, expect, it, vi } from "vitest";
import { type Command, dispatch, replArguments } from "../index.ts";

const command = (
  name: string,
  args: string[],
  missingArgument?: string,
): Command & { run: ReturnType<typeof vi.fn> } => ({
  name,
  arguments: args,
  description: name,
  ...(missingArgument ? { missingArgument } : {}),
  run: vi.fn(async () => "continue" as const),
});

describe("dispatch", () => {
  it("команда с аргументом без текста не запускается и называет, чего не хватает", () => {
    const info = command("info", ["<вопрос...>"], "Не указан вопрос о проекте.");
    expect(() => dispatch([info], ["info", "  "])).toThrow("Не указан вопрос о проекте.");
    expect(info.run).not.toHaveBeenCalled();
  });

  it("команда без аргументов отклоняет лишний текст", () => {
    const help = command("help", []);
    expect(() => dispatch([help], ["help", "вопрос"])).toThrow("У команды нет аргументов.");
  });

  it("строка REPL /info передаёт слова вопроса", () => {
    expect(replArguments("/info какая сейчас ветка?")).toEqual(["info", "какая", "сейчас", "ветка?"]);
  });
});
