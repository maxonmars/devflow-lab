import { GitError } from "./errors.ts";
import type { RunGit } from "./run.ts";

export const MAX_STATUS_LINES = 200;
export const MAX_DIFF_CHARS = 12_000;
export const MAX_FILES = 300;
export const MAX_CHANGED_FILES = 300;
export const MAX_FILE_CHARS = 20_000;

export type BranchInfo = Readonly<{
  /** `null` — HEAD отсоединён от ветки. */
  branch: string | null;
  /** `null` — в ветке ещё нет коммитов. */
  head: Readonly<{ sha: string; subject: string }> | null;
}>;

export type StatusInfo = Readonly<{ lines: readonly string[]; total: number; truncated: boolean }>;
export type DiffInfo = Readonly<{ stat: string; diff: string; totalChars: number; truncated: boolean }>;
export type FilesInfo = Readonly<{ files: readonly string[]; total: number; truncated: boolean }>;
/** `status` — первая буква статуса git (`A M D R C T`); `from` — прежний путь у R и C. */
export type ChangedFile = Readonly<{ status: string; path: string; from?: string }>;
export type ChangesInfo = Readonly<{ files: readonly ChangedFile[]; total: number; truncated: boolean }>;
export type FileInfo = Readonly<{
  path: string;
  content: string;
  totalChars: number;
  truncated: boolean;
  binary: boolean;
}>;

/** Pathspec по умолчанию — `.`: вывод не выходит за корень проекта, даже если он подкаталог репозитория. */
const pathspec = (path: string | undefined): string => path ?? ".";

export async function readBranch(runGit: RunGit): Promise<BranchInfo> {
  let branch: string | null;
  try {
    branch = (await runGit(["symbolic-ref", "--quiet", "--short", "HEAD"])).trim();
  } catch (error) {
    // `symbolic-ref --quiet` завершается кодом 1 без текста, когда HEAD указывает на коммит, а не на ветку.
    if (!(error instanceof GitError && error.code === "FAILED" && error.exitCode === 1)) throw error;
    branch = null;
  }
  try {
    const [sha = "", subject = ""] = (await runGit(["log", "-1", "--format=%h%x00%s"])).trim().split("\0");
    return { branch, head: { sha, subject } };
  } catch (error) {
    if (error instanceof GitError && error.code === "NO_COMMITS") return { branch, head: null };
    throw error;
  }
}

export async function readStatus(runGit: RunGit): Promise<StatusInfo> {
  const lines = (await runGit(["status", "--short", "--branch", "--", "."])).split("\n").filter(Boolean);
  return { lines: lines.slice(0, MAX_STATUS_LINES), total: lines.length, truncated: lines.length > MAX_STATUS_LINES };
}

/** Ref базы должен указывать на коммит: `rev-parse --verify --quiet` завершается кодом 1 без текста, если его нет. */
async function verifyBase(runGit: RunGit, base: string): Promise<void> {
  try {
    await runGit(["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
  } catch (error) {
    if (error instanceof GitError && error.code === "FAILED" && error.exitCode === 1) throw new GitError("UNKNOWN_REF");
    throw error;
  }
}

const cut = (text: string, limit: number) => {
  const chars = [...text];
  return { text: chars.slice(0, limit).join(""), totalChars: chars.length, truncated: chars.length > limit };
};

/** С `base` — изменения ветки от merge-base (`base...HEAD`), иначе рабочая копия или индекс. */
export async function readDiff(
  runGit: RunGit,
  options: Readonly<{ staged: boolean; path?: string; base?: string }>,
): Promise<DiffInfo> {
  if (options.base !== undefined) await verifyBase(runGit, options.base);
  const scope = options.base !== undefined ? [`${options.base}...HEAD`] : options.staged ? ["--cached"] : [];
  // Внешний diff-драйвер и textconv из конфига репозитория запускают команды; при чтении они выключены.
  const command = ["diff", "--no-ext-diff", "--no-textconv", "--no-color", ...scope];
  const stat = (await runGit([...command, "--stat", "--", pathspec(options.path)])).trimEnd();
  const full = cut(await runGit([...command, "--", pathspec(options.path)]), MAX_DIFF_CHARS);
  return { stat, diff: full.text.trimEnd(), totalChars: full.totalChars, truncated: full.truncated };
}

/** Разбор `diff --name-status -z`: у R и C за статусом идут два пути — прежний и новый. */
export function parseNameStatus(output: string): ChangedFile[] {
  const fields = output.split("\0");
  const files: ChangedFile[] = [];
  for (let index = 0; index < fields.length; ) {
    const status = (fields[index] ?? "").charAt(0);
    if (!status) break;
    if (status === "R" || status === "C") {
      files.push({ status, path: fields[index + 2] ?? "", from: fields[index + 1] ?? "" });
      index += 3;
    } else {
      files.push({ status, path: fields[index + 1] ?? "" });
      index += 2;
    }
  }
  return files;
}

/** Пути `--relative` — от корня проекта, их можно передавать как `path` в `git_diff` и `read_file`. */
export async function readChangedFiles(runGit: RunGit, base: string): Promise<ChangesInfo> {
  await verifyBase(runGit, base);
  const output = await runGit([
    "diff",
    "--name-status",
    "-z",
    "--relative",
    "-M",
    "--no-ext-diff",
    `${base}...HEAD`,
    "--",
    ".",
  ]);
  const files = parseNameStatus(output);
  return {
    files: files.slice(0, MAX_CHANGED_FILES),
    total: files.length,
    truncated: files.length > MAX_CHANGED_FILES,
  };
}

/** Содержимое файла в HEAD; `./` отсчитывает путь от `-C root`, а не от корня репозитория. */
export async function readFile(runGit: RunGit, path: string): Promise<FileInfo> {
  const content = await runGit(["cat-file", "blob", `HEAD:./${path}`]);
  if (content.includes("\0")) return { path, content: "", totalChars: 0, truncated: false, binary: true };
  const shown = cut(content, MAX_FILE_CHARS);
  return { path, content: shown.text, totalChars: shown.totalChars, truncated: shown.truncated, binary: false };
}

export async function listFiles(runGit: RunGit, path: string | undefined): Promise<FilesInfo> {
  const files = (await runGit(["ls-files", "-z", "--", pathspec(path)])).split("\0").filter(Boolean);
  return { files: files.slice(0, MAX_FILES), total: files.length, truncated: files.length > MAX_FILES };
}
