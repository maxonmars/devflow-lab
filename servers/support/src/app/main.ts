import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createSupportServer } from "../index.ts";

function dataFile(argv: readonly string[]): string {
  const value = argv[argv.indexOf("--data") + 1];
  if (!argv.includes("--data") || !value) {
    console.error("Нужен аргумент --data <файл клиентов и тикетов>.");
    process.exit(2);
  }
  const path = resolve(value);
  if (!statSync(path, { throwIfNoEntry: false })?.isFile()) {
    console.error("Файл данных из --data не найден или не является файлом.");
    process.exit(2);
  }
  return path;
}

const path = dataFile(process.argv.slice(2));

serveStdio(() => createSupportServer({ readData: () => readFile(path, "utf8") }), {
  onerror: (error) => console.error(error),
});

process.stdin.on("end", () => process.exit(0));
