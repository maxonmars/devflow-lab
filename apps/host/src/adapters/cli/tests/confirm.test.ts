import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { isYes, readAnswer } from "../index.ts";

describe("readAnswer", () => {
  it("читает первую строку и не требует остального ввода", async () => {
    expect(await readAnswer(Readable.from(["да\nвторая строка\n"]))).toBe("да");
  });

  it("строка без перевода строки в конце тоже ответ", async () => {
    expect(await readAnswer(Readable.from(["y"]))).toBe("y");
  });

  it("пустая строка — пустой ответ, закрытый поток — undefined", async () => {
    expect(await readAnswer(Readable.from(["\n"]))).toBe("");
    expect(await readAnswer(Readable.from([]))).toBeUndefined();
    expect(await readAnswer(Readable.from([""]))).toBeUndefined();
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
