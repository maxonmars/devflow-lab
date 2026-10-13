import type { Range } from "../types.ts";

/** Окна по `size` кодовых точек с шагом `size − overlap`; последнее окно доходит до конца текста. */
export function fixedRanges(start: number, end: number, size: number, overlap: number): Range[] {
  const ranges: Range[] = [];
  for (let from = start; from < end; from += size - overlap) {
    const to = Math.min(from + size, end);
    ranges.push({ start: from, end: to });
    if (to === end) break;
  }
  return ranges;
}
