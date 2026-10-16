import { PassThrough, Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLineReader, isYes } from "../index.ts";

describe("createLineReader.question", () => {
  it("читает первую строку; закрытие интерфейса не требует остального ввода", async () => {
    const reader = createLineReader(Readable.from(["да\nвторая строка\n"]));
    expect(await reader.question()).toBe("да");
    reader.close();
  });

  it("строка без перевода строки перед EOF не ответ: readline отдаёт её событию line", async () => {
    expect(await createLineReader(Readable.from(["y"])).question()).toBeUndefined();
  });

  it("пустая строка — пустой ответ, закрытый поток — undefined", async () => {
    expect(await createLineReader(Readable.from(["\n"])).question()).toBe("");
    expect(await createLineReader(Readable.from([])).question()).toBeUndefined();
    expect(await createLineReader(Readable.from([""])).question()).toBeUndefined();
  });

  it("вопрос после закрытия потока — undefined без ожидания", async () => {
    const reader = createLineReader(Readable.from([]));
    expect(await reader.question()).toBeUndefined();
    expect(await reader.question()).toBeUndefined();
  });

  it("строку, пришедшую во время вопроса, получает вопрос, а не цикл строк", async () => {
    const input = new PassThrough();
    const reader = createLineReader(input);
    const seen: string[] = [];
    const loop = (async () => {
      for await (const line of reader.lines()) {
        seen.push(line);
        if (line === "команда") seen.push(`ответ: ${await reader.question()}`);
      }
    })();
    input.write("команда\n");
    await new Promise((resolve) => setImmediate(resolve));
    input.end("y\nследующая\n");
    await loop;
    expect(seen).toEqual(["команда", "ответ: y", "следующая"]);
  });
});

describe("isYes", () => {
  it.each(["y", "Y", "yes", "YES", " да ", "Да", "д"])("«%s» — согласие", (answer) => {
    expect(isYes(answer)).toBe(true);
  });

  it.each(["n", "no", "нет", "", "yy", "yes please", "да!"])("«%s» — отказ", (answer) => {
    expect(isYes(answer)).toBe(false);
  });

  it("EOF — отказ", () => {
    expect(isYes(undefined)).toBe(false);
  });
});
