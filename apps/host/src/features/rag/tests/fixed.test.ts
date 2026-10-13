import { expect, it } from "vitest";
import { fixedRanges } from "../chunking/fixed.ts";

it("режет окнами с шагом size − overlap; последнее окно доходит до конца", () => {
  expect(fixedRanges(0, 250, 100, 20)).toEqual([
    { start: 0, end: 100 },
    { start: 80, end: 180 },
    { start: 160, end: 250 },
  ]);
});

it("короткий текст даёт одно окно, пустой — ни одного", () => {
  expect(fixedRanges(0, 60, 100, 20)).toEqual([{ start: 0, end: 60 }]);
  expect(fixedRanges(5, 5, 100, 20)).toEqual([]);
});

it("окна покрывают диапазон без пропусков, перекрытие соседних равно overlap", () => {
  const ranges = fixedRanges(10, 1000, 300, 50);
  expect(ranges[0]?.start).toBe(10);
  expect(ranges.at(-1)?.end).toBe(1000);
  for (const [index, range] of ranges.entries()) {
    expect(range.end - range.start).toBeLessThanOrEqual(300);
    const next = ranges[index + 1];
    if (next) expect(range.end - next.start).toBe(50);
  }
});

it("нулевое перекрытие даёт смежные окна", () => {
  expect(fixedRanges(0, 25, 10, 0)).toEqual([
    { start: 0, end: 10 },
    { start: 10, end: 20 },
    { start: 20, end: 25 },
  ]);
});
