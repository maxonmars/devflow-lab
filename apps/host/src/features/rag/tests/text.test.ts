import { expect, it } from "vitest";
import { CodePointText } from "../text.ts";

it("индексирует по кодовым точкам: символ вне BMP занимает одну позицию", () => {
  const text = new CodePointText("a😀б");
  expect(text.text.length).toBe(4);
  expect(text.length).toBe(3);
  expect(text.slice(1, 2)).toBe("😀");
  expect(text.slice(0, 3)).toBe("a😀б");
  expect(text.slice(2, 3)).toBe("б");
});

it("переводит смещения UTF-16 в кодовые точки на границах символов", () => {
  const text = new CodePointText("a😀б");
  expect([0, 1, 3, 4].map((offset) => text.fromUtf16(offset))).toEqual([0, 1, 2, 3]);
});

it("пустой текст имеет нулевую длину", () => {
  const text = new CodePointText("");
  expect(text.length).toBe(0);
  expect(text.slice(0, 0)).toBe("");
});
