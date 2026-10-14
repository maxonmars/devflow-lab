import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { describeGitError } from "../git/errors.ts";
import { listFiles, readBranch, readChangedFiles, readDiff, readFile, readStatus } from "../git/readers.ts";
import type { RunGit } from "../git/run.ts";
import { branchText, changesText, diffText, filesText, fileText, statusText } from "./format.ts";

export const GIT_TOOL_NAMES = {
  branch: "git_branch",
  status: "git_status",
  files: "list_files",
  diff: "git_diff",
  changedFiles: "git_changed_files",
  readFile: "read_file",
} as const;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const insideRoot = (path: string) =>
  !path.startsWith("/") && !/^[A-Za-z]:/.test(path) && !path.split(/[\\/]/).includes("..");

const pathInput = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine(insideRoot, "Путь должен быть относительным и не выходить за корень проекта.")
  .describe("Необязательный путь внутри проекта относительно его корня, например «docs» или «README.md».");

// Без `..`, `:`, пробелов и ведущего `-`: ref не превращается в диапазон, путь в дереве или опцию git.
const refInput = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_][A-Za-z0-9._/@^~-]*$/, "Недопустимые символы в ref базы.")
  .refine((ref) => !ref.includes(".."), "Ref базы не может содержать «..».")
  .describe("Базовая ветка или коммит, например origin/main.");

const branchOutput = z.object({
  branch: z.string().nullable(),
  head: z.object({ sha: z.string(), subject: z.string() }).nullable(),
});
const statusOutput = z.object({ lines: z.array(z.string()), total: z.number(), truncated: z.boolean() });
const diffOutput = z.object({ stat: z.string(), diff: z.string(), totalChars: z.number(), truncated: z.boolean() });
const filesOutput = z.object({ files: z.array(z.string()), total: z.number(), truncated: z.boolean() });
const changesOutput = z.object({
  files: z.array(z.object({ status: z.string(), path: z.string(), from: z.string().optional() })),
  total: z.number(),
  truncated: z.boolean(),
});
const fileOutput = z.object({
  path: z.string(),
  content: z.string(),
  totalChars: z.number(),
  truncated: z.boolean(),
  binary: z.boolean(),
});

type Reply = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: true };

/** Ошибка git становится результатом с `isError`: модель видит причину, MCP-вызов не обрывается. */
async function reply<T extends Record<string, unknown>>(read: () => Promise<T>, text: (value: T) => string) {
  try {
    const value = await read();
    return { content: [{ type: "text" as const, text: text(value) }], structuredContent: value } satisfies Reply;
  } catch (error) {
    return {
      isError: true as const,
      content: [{ type: "text" as const, text: describeGitError(error) }],
    } satisfies Reply;
  }
}

/** Текущее состояние репозитория: ветка, статус, отслеживаемые файлы. */
function registerStateTools(server: McpServer, runGit: RunGit): void {
  server.registerTool(
    GIT_TOOL_NAMES.branch,
    {
      description: "Текущая git-ветка проекта и последний коммит HEAD (короткий хеш и заголовок).",
      inputSchema: z.object({}),
      outputSchema: branchOutput,
      annotations: READ_ONLY,
    },
    () => reply(() => readBranch(runGit), branchText),
  );
  server.registerTool(
    GIT_TOOL_NAMES.status,
    {
      description: "Краткий git status корня проекта: ветка, отслеживание удалённой ветки, изменённые и новые файлы.",
      inputSchema: z.object({}),
      outputSchema: statusOutput,
      annotations: READ_ONLY,
    },
    () => reply(() => readStatus(runGit), statusText),
  );
  server.registerTool(
    GIT_TOOL_NAMES.files,
    {
      description:
        "Список отслеживаемых git файлов проекта (git ls-files), целиком или внутри папки path. Игнорируемые и " +
        "неотслеживаемые файлы не показываются.",
      inputSchema: z.object({ path: pathInput.optional() }),
      outputSchema: filesOutput,
      annotations: READ_ONLY,
    },
    ({ path }) =>
      reply(
        () => listFiles(runGit, path),
        (info) => filesText(info, path),
      ),
  );
}

/** Изменения: рабочая копия, индекс или ветка относительно базы, а также файлы HEAD. */
function registerChangeTools(server: McpServer, runGit: RunGit): void {
  server.registerTool(
    GIT_TOOL_NAMES.diff,
    {
      description:
        "Изменения в проекте: сводка git diff --stat и сам diff, обрезанный по длине. По умолчанию — изменения " +
        "рабочей копии, не добавленные в индекс; staged: true — изменения в индексе; base — изменения ветки " +
        "относительно базы (base...HEAD). path сужает diff до файла или папки.",
      inputSchema: z
        .object({
          staged: z.boolean().default(false).describe("true — показать изменения, уже добавленные в индекс."),
          path: pathInput.optional(),
          base: refInput.optional(),
        })
        .refine((input) => !(input.base !== undefined && input.staged), "base нельзя сочетать со staged: true."),
      outputSchema: diffOutput,
      annotations: READ_ONLY,
    },
    ({ staged, path, base }) =>
      reply(
        () => readDiff(runGit, { staged, ...(path ? { path } : {}), ...(base !== undefined ? { base } : {}) }),
        (info) => diffText(info, staged, base),
      ),
  );
  server.registerTool(
    GIT_TOOL_NAMES.changedFiles,
    {
      description:
        "Список файлов проекта, изменённых в текущей ветке относительно базы (base...HEAD, от merge-base), со " +
        "статусом: A — добавлен, M — изменён, D — удалён, R — переименован, C — скопирован, T — сменился тип.",
      inputSchema: z.object({ base: refInput }),
      outputSchema: changesOutput,
      annotations: READ_ONLY,
    },
    ({ base }) =>
      reply(
        () => readChangedFiles(runGit, base),
        (info) => changesText(info, base),
      ),
  );
  server.registerTool(
    GIT_TOOL_NAMES.readFile,
    {
      description:
        "Содержимое отслеживаемого файла проекта в HEAD, обрезанное по длине. Неотслеживаемые и игнорируемые " +
        "файлы, а также незакоммиченные изменения не видны; двоичный файл не показывается.",
      inputSchema: z.object({
        path: pathInput.describe("Путь к файлу внутри проекта относительно его корня, например «README.md»."),
      }),
      outputSchema: fileOutput,
      annotations: READ_ONLY,
    },
    ({ path }) => reply(() => readFile(runGit, path), fileText),
  );
}

export function registerGitTools(server: McpServer, runGit: RunGit): void {
  registerStateTools(server, runGit);
  registerChangeTools(server, runGit);
}
