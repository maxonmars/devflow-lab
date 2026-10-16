import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

const YES = new Set(["y", "yes", "д", "да"]);

/** Первая строка потока; `undefined` — поток закрылся без ввода. Интерфейс закрывается, ввод дальше не читается. */
export async function readAnswer(input: Readable): Promise<string | undefined> {
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) return line;
    return undefined;
  } finally {
    lines.close();
  }
}

/** Согласие — только явное «y», «yes», «д», «да» без учёта регистра; пустой ответ и EOF — отказ. */
export function isYes(answer: string | undefined): boolean {
  return YES.has((answer ?? "").trim().toLowerCase());
}
