import { describe, expect, it, vi } from "vitest";
import { type Command, dispatch, replArguments } from "../index.ts";

const command = (name: string, args: string[]): Command & { run: ReturnType<typeof vi.fn> } => ({
  name,
  arguments: args,
  description: name,
  run: vi.fn(async () => "continue" as const),
});

describe("dispatch", () => {
  it("аргумент в квадратных скобках необязателен: команда запускается и без него", async () => {
    const help = command("help", ["[вопрос...]"]);
    await dispatch([help], ["help"]);
    await dispatch([help], ["help", "Какая", "ветка?"]);
    expect(help.run.mock.calls).toEqual([[[]], [["Какая", "ветка?"]]]);
  });

  it("обязательный аргумент по-прежнему требует текст", () => {
    const ask = command("ask", ["<текст...>"]);
    expect(() => dispatch([ask], ["ask", "  "])).toThrow("Не указан текст реплики.");
    expect(ask.run).not.toHaveBeenCalled();
  });

  it("строка REPL /help с вопросом передаёт слова вопроса", () => {
    expect(replArguments("/help какая сейчас ветка?")).toEqual(["help", "какая", "сейчас", "ветка?"]);
    expect(replArguments("/help")).toEqual(["help"]);
  });
});
