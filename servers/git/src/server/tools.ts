import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { describeGitError } from "../git/errors.ts";
import { listFiles, readBranch, readDiff, readStatus } from "../git/readers.ts";
import type { RunGit } from "../git/run.ts";
import { branchText, diffText, filesText, statusText } from "./format.ts";

export const GIT_TOOL_NAMES = {
  branch: "git_branch",
  status: "git_status",
  diff: "git_diff",
  files: "list_files",
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

const branchOutput = z.object({
  branch: z.string().nullable(),
  head: z.object({ sha: z.string(), subject: z.string() }).nullable(),
});
const statusOutput = z.object({ lines: z.array(z.string()), total: z.number(), truncated: z.boolean() });
const diffOutput = z.object({ stat: z.string(), diff: z.string(), totalChars: z.number(), truncated: z.boolean() });
const filesOutput = z.object({ files: z.array(z.string()), total: z.number(), truncated: z.boolean() });

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

export function registerGitTools(server: McpServer, runGit: RunGit): void {
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
    GIT_TOOL_NAMES.diff,
    {
      description:
        "Изменения в проекте: сводка git diff --stat и сам diff, обрезанный по длине. По умолчанию — изменения " +
        "рабочей копии, не добавленные в индекс; staged: true — изменения в индексе. path сужает diff до файла или папки.",
      inputSchema: z.object({
        staged: z.boolean().default(false).describe("true — показать изменения, уже добавленные в индекс."),
        path: pathInput.optional(),
      }),
      outputSchema: diffOutput,
      annotations: READ_ONLY,
    },
    ({ staged, path }) =>
      reply(
        () => readDiff(runGit, { staged, ...(path ? { path } : {}) }),
        (info) => diffText(info, staged),
      ),
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
