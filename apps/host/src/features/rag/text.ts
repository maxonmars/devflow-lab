import { createHash } from "node:crypto";

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Текст с индексацией по кодовым точкам Unicode; смещения mdast и String.slice считают в единицах UTF-16. */
export class CodePointText {
  readonly text: string;
  readonly length: number;
  readonly #units: Uint32Array;

  constructor(text: string) {
    const units: number[] = [];
    for (let unit = 0; unit < text.length; ) {
      units.push(unit);
      unit += (text.codePointAt(unit) ?? 0) > 0xffff ? 2 : 1;
    }
    units.push(text.length);
    this.text = text;
    this.#units = Uint32Array.from(units);
    this.length = units.length - 1;
  }

  slice(start: number, end: number): string {
    return this.text.slice(this.#units[start], this.#units[end]);
  }

  /** Индекс кодовой точки для смещения UTF-16 на границе символа. */
  fromUtf16(offset: number): number {
    let low = 0;
    let high = this.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((this.#units[middle] ?? 0) < offset) low = middle + 1;
      else high = middle;
    }
    return low;
  }
}
