import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { InputError } from "../adapters/cli/index.ts";
import type { JsonObject, ToolSource } from "../core/index.ts";
import { type SearchHit, searchQueries } from "../features/rag/index.ts";
import { type ReviewDoc, type ReviewFile, renderReview, reviewChanges } from "../features/review/index.ts";
import { type McpServers, systemPrompt } from "./ask.ts";
import { prepareRag, type RagAnswerHandlerOptions } from "./ragAnswer.ts";
import { combineToolSources, type WithToolSource, withSessions } from "./toolSources.ts";

/** Лимиты контекста ревью: число файлов и кодовые точки diff и содержимого всех файлов вместе. */
export const MAX_REVIEW_FILES = 20;
export const MAX_REVIEW_CONTEXT_CHARS = 80_000;
/** Сколько кодовых точек diff файла входит в его запрос к RAG. */
export const REVIEW_QUERY_CHARS = 1500;

/** Имена инструментов git-сервера; host не импортирует сервер, поэтому они повторены здесь. */
export const REVIEW_GIT_TOOLS = {
  changedFiles: "git_changed_files",
  diff: "git_diff",
  readFile: "read_file",
} as const;

export type ReviewHandlerOptions = RagAnswerHandlerOptions &
  Readonly<{ servers: McpServers; withToolSource: WithToolSource }>;

type ChangedFile = Readonly<{ status: string; path: string; from?: string }>;

const length = (text: string) => [...text].length;

/** Разбор текста `git_changed_files` по контракту из servers/git/README.md. */
export function parseChangedFiles(text: string): ChangedFile[] {
  if (/^Изменённых файлов относительно .+ нет\.$/.test(text.trim())) return [];
  const [header = "", ...lines] = text.trimEnd().split("\n");
  if (!/^Изменённые файлы относительно .+ \(\d+\):$/.test(header)) {
    throw new InputError("Неожиданный формат списка изменённых файлов git-сервера.");
  }
  return lines
    .filter((line) => !/^Показано \d+ из \d+\.$/.test(line))
    .map((line) => {
      const match = /^([A-Z]) (.+)$/.exec(line);
      if (!match?.[1] || !match[2]) throw new InputError("Неожиданный формат списка изменённых файлов git-сервера.");
      const [path = "", from] = match[2].split(" ← ");
      return from === undefined ? { status: match[1], path } : { status: match[1], path, from };
    });
}

/** Текст результата инструмента; `isError` — InputError с текстом сервера: причина git или схемы, без stderr git. */
async function callText(source: ToolSource, name: string, args: JsonObject): Promise<string> {
  const result = await source.callTool({ name, arguments: args });
  if (result.isError) throw new InputError(result.content);
  return result.content;
}

/**
 * Diff и содержимое HEAD по файлам в пределах лимитов. Файл, чьё содержимое не помещается, остаётся с одним diff;
 * не поместился и diff — файл уходит в `omitted`. Ошибка `read_file` идёт текстом вместо содержимого.
 */
async function collectFiles(source: ToolSource, base: string, changed: readonly ChangedFile[]) {
  const files: ReviewFile[] = [];
  const omitted: string[] = [];
  let budget = MAX_REVIEW_CONTEXT_CHARS;
  for (const [position, file] of changed.entries()) {
    if (position > MAX_REVIEW_FILES) {
      omitted.push(file.path);
      continue;
    }
    const diff = await callText(source, REVIEW_GIT_TOOLS.diff, { base, path: file.path });
    if (length(diff) > budget) {
      omitted.push(file.path);
      continue;
    }
    budget -= length(diff);
    let content: string | undefined;
    if (file.status !== "D") {
      const result = await source.callTool({ name: REVIEW_GIT_TOOLS.readFile, arguments: { path: file.path } });
      if (length(result.content) <= budget) {
        content = result.content;
        budget -= length(content);
      }
    }
    files.push({ ...file, diff, ...(content === undefined ? {} : { content }) });
  }
  return { files, omitted };
}

const toDoc = ({ rank, chunk }: SearchHit): ReviewDoc => ({
  rank,
  file: chunk.file,
  title: chunk.title,
  sections: chunk.sections,
  text: chunk.text,
});

async function requireReviewTools(source: ToolSource): Promise<void> {
  const names = new Set((await source.listTools()).map((tool) => tool.name));
  if (!Object.values(REVIEW_GIT_TOOLS).every((name) => names.has(name))) {
    throw new InputError("MCP-серверы не объявили git-инструменты ревью.");
  }
}

/** Временный файл рядом и `rename`: при ошибке прежний файл ревью остаётся целым. */
async function writeReviewFile(path: string, markdown: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temporary, `${markdown}\n`, "utf8");
    await rename(temporary, path);
  } catch {
    await rm(temporary, { force: true }).catch(() => {});
    throw new InputError("Не удалось записать файл ревью.");
  }
}

/** `review <база>`: параметры, модель и индекс проверяются до запуска MCP-серверов; модель вызывается один раз. */
export function createReviewHandler(options: ReviewHandlerOptions): (base: string) => Promise<string> {
  return async (base) => {
    const { values, model, modelName, index, retrieval } = await prepareRag(options);
    const config = options.getConfig();
    const markdown = await withSessions(
      options.servers(config),
      options.withToolSource,
      options.view,
      async (sources) => {
        const source = combineToolSources(sources);
        await requireReviewTools(source);
        const changed = parseChangedFiles(await callText(source, REVIEW_GIT_TOOLS.changedFiles, { base }));
        if (changed.length === 0) return `## AI-ревью\n\nИзменений относительно ${base} нет.`;
        const { files, omitted } = await collectFiles(source, base, changed);
        const queries = files.map((file) => `${file.path}\n${[...file.diff].slice(0, REVIEW_QUERY_CHARS).join("")}`);
        const docs = (await searchQueries({ index, queries, ...retrieval })).map(toDoc);
        const input = { base, files, omitted, docs };
        return renderReview(await reviewChanges({ model, systemPrompt: systemPrompt(), input }), input, modelName);
      },
    );
    const outputFile = values["review.outputFile"];
    if (outputFile) await writeReviewFile(resolve(options.cwd, outputFile), markdown);
    return markdown;
  };
}
