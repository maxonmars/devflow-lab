import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { describeFilesError } from "../files/errors.ts";
import { type FilesContext, readVisibleFile, searchFiles } from "../files/readers.ts";
import { MAX_WRITE_CHARS, writeVisibleFile } from "../files/writer.ts";
import { searchText } from "./format.ts";

export const FILES_TOOL_NAMES = { search: "files_search", read: "files_read", write: "files_write" } as const;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;

const insideRoot = (path: string) =>
  !path.startsWith("/") && !/^[A-Za-z]:/.test(path) && !path.split(/[\\/]/).includes("..");

const pathInput = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine(insideRoot, "Путь должен быть относительным и не выходить за корень проекта.");

const markdownPath = pathInput
  .refine((path) => path.endsWith(".md"), "Записывать можно только файлы с расширением .md.")
  .refine((path) => !path.split(/[\\/]/).includes(".git"), "Путь не может содержать каталог .git.");

/** Ошибка становится результатом с `isError`: модель видит причину, MCP-вызов не обрывается. */
async function reply(read: () => Promise<string>) {
  try {
    return { content: [{ type: "text" as const, text: await read() }] };
  } catch (error) {
    return { isError: true as const, content: [{ type: "text" as const, text: describeFilesError(error) }] };
  }
}

export function registerFilesTools(server: McpServer, context: FilesContext): void {
  server.registerTool(
    FILES_TOOL_NAMES.search,
    {
      description:
        "Поиск строки (без регулярных выражений) по видимым файлам проекта: отслеживаемым и неотслеживаемым, но не " +
        "игнорируемым. Возвращает строки вида путь:номер: текст; path сужает поиск до файла или папки.",
      inputSchema: z.object({
        query: z.string().min(1).max(200).describe("Искомая строка, например имя функции или компонента."),
        path: pathInput.optional().describe("Необязательный файл или папка внутри проекта."),
        ignoreCase: z.boolean().default(false).describe("true — не различать регистр."),
      }),
      annotations: READ_ONLY,
    },
    ({ query, path, ignoreCase }) =>
      reply(async () =>
        searchText(await searchFiles(context, { query, ignoreCase, ...(path ? { path } : {}) }), query),
      ),
  );
  server.registerTool(
    FILES_TOOL_NAMES.read,
    {
      description:
        "Содержимое видимого текстового файла проекта из рабочей копии, дословно и без заголовков. Двоичные и " +
        "слишком большие файлы не читаются.",
      inputSchema: z.object({ path: pathInput.describe("Путь к файлу относительно корня проекта.") }),
      annotations: READ_ONLY,
    },
    ({ path }) => reply(() => readVisibleFile(context, path)),
  );
  server.registerTool(
    FILES_TOOL_NAMES.write,
    {
      description:
        "Заменяет содержимое существующего видимого Markdown-файла (.md) проекта. Создание, удаление, " +
        "переименование и запись файлов других типов не поддерживаются.",
      inputSchema: z.object({
        path: markdownPath.describe("Путь к существующему .md-файлу относительно корня проекта."),
        content: z.string().max(MAX_WRITE_CHARS).describe("Новое содержимое файла целиком."),
      }),
      annotations: WRITE,
    },
    ({ path, content }) =>
      reply(async () => {
        await writeVisibleFile(context, path, content);
        return `Записан файл ${path}.`;
      }),
  );
}
