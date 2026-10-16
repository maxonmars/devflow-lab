import { lstat, readFile, realpath } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import { FilesError } from "./errors.ts";
import type { RunGit } from "./run.ts";

export const MAX_SEARCH_MATCHES = 100;
export const MAX_MATCH_LINE_CHARS = 200;
export const MAX_READ_CHARS = 20_000;

/** `root` — корень проекта: файловые операции идут относительно него, git запускается в нём же. */
export type FilesContext = Readonly<{ runGit: RunGit; root: string }>;

export type SearchMatch = Readonly<{ path: string; line: number; text: string }>;
export type SearchInfo = Readonly<{ matches: readonly SearchMatch[]; total: number; truncated: boolean }>;
export type SearchOptions = Readonly<{ query: string; path?: string; ignoreCase: boolean }>;

const cut = (text: string, limit: number) => [...text].slice(0, limit).join("");

/** Разбор `git grep -z -n`: строка `путь\0номер\0текст`. */
export function parseGrep(output: string): SearchMatch[] {
  return output
    .split("\n")
    .filter(Boolean)
    .flatMap((row) => {
      const [path, line, ...rest] = row.split("\0");
      const number = Number(line);
      if (path === undefined || !Number.isInteger(number)) return [];
      return [{ path, line: number, text: cut(rest.join("\0").trimEnd(), MAX_MATCH_LINE_CHARS) }];
    });
}

/** Поиск строки в видимых файлах; `git grep` завершается кодом 1 без вывода, когда совпадений нет. */
export async function searchFiles({ runGit }: FilesContext, options: SearchOptions): Promise<SearchInfo> {
  const flags = ["-z", "-n", "-I", "-F", "--untracked", "--no-color", ...(options.ignoreCase ? ["-i"] : [])];
  let output = "";
  try {
    output = await runGit(["grep", ...flags, "-e", options.query, "--", options.path ?? "."]);
  } catch (error) {
    if (!(error instanceof FilesError && error.code === "FAILED" && error.exitCode === 1)) throw error;
  }
  const matches = parseGrep(output);
  return {
    matches: matches.slice(0, MAX_SEARCH_MATCHES),
    total: matches.length,
    truncated: matches.length > MAX_SEARCH_MATCHES,
  };
}

/**
 * Абсолютный путь видимого обычного файла: он значится в `git ls-files --cached --others --exclude-standard`,
 * не symlink и после `realpath` остаётся внутри корня.
 */
export async function resolveVisibleFile({ runGit, root }: FilesContext, path: string): Promise<string> {
  const relative = normalize(path);
  const listed = (await runGit(["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", relative]))
    .split("\0")
    .filter(Boolean);
  if (listed.length !== 1 || listed[0] !== relative) throw new FilesError("FILE_NOT_FOUND");
  const target = join(root, relative);
  const info = await lstat(target).catch(() => undefined);
  if (!info) throw new FilesError("FILE_NOT_FOUND");
  if (!info.isFile()) throw new FilesError("NOT_A_FILE");
  const realRoot = await realpath(root);
  if (!(await realpath(target)).startsWith(realRoot + sep)) throw new FilesError("OUTSIDE_ROOT");
  return target;
}

/** Содержимое видимого файла дословно: BOM сохраняется, чтобы запись обратно не меняла файл. */
export async function readVisibleFile(context: FilesContext, path: string): Promise<string> {
  const target = await resolveVisibleFile(context, path);
  const bytes = await readFile(target);
  if (bytes.includes(0)) throw new FilesError("BINARY");
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new FilesError("BINARY");
  }
  if ([...content].length > MAX_READ_CHARS) throw new FilesError("TOO_LARGE");
  return content;
}
