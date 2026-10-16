import { createInterface, type Interface } from "node:readline";
import type { Readable } from "node:stream";

const YES = new Set(["y", "yes", "д", "да"]);

/** Единственный readline на поток ввода: строки REPL и ответы на вопросы читает один интерфейс. */
export type LineReader = Readonly<{
  lines: () => AsyncIterable<string>;
  /** Следующая строка ввода; `undefined` — поток закрылся без ответа. */
  question: () => Promise<string | undefined>;
  close: () => void;
}>;

export function createLineReader(input: Readable): LineReader {
  let lines: Interface | undefined;
  let closed = false;
  const open = (): Interface => {
    if (!lines) {
      lines = createInterface({ input, crlfDelay: Infinity });
      lines.once("close", () => {
        closed = true;
      });
    }
    return lines;
  };
  return {
    lines: open,
    question: () => {
      const current = open();
      if (closed) return Promise.resolve(undefined);
      return new Promise((resolve) => {
        const onClose = () => resolve(undefined);
        current.once("close", onClose);
        // Пока вопрос ждёт ответа, readline отдаёт строку колбэку, а не событию `line` цикла REPL.
        current.question("", (answer) => {
          current.off("close", onClose);
          resolve(answer);
        });
      });
    },
    close: () => lines?.close(),
  };
}

/** Согласие — только явное «y», «yes», «д», «да» без учёта регистра; пустой ответ и EOF — отказ. */
export function isYes(answer: string | undefined): boolean {
  return YES.has((answer ?? "").trim().toLowerCase());
}
