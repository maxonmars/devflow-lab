import { statSync } from "node:fs";
import { resolve } from "node:path";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createGitRunner, createGitServer } from "../index.ts";

function projectRoot(argv: readonly string[]): string {
  const value = argv[argv.indexOf("--root") + 1];
  if (!argv.includes("--root") || !value) {
    console.error("Нужен аргумент --root <каталог проекта>.");
    process.exit(2);
  }
  const root = resolve(value);
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    console.error("Корень проекта из --root не найден или не является каталогом.");
    process.exit(2);
  }
  return root;
}

const root = projectRoot(process.argv.slice(2));
// LC_ALL=C — английский stderr git: по нему распознаются причины ошибок.
const env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };

serveStdio(() => createGitServer({ runGit: createGitRunner({ root, env }) }), {
  onerror: (error) => console.error(error),
});

process.stdin.on("end", () => process.exit(0));
