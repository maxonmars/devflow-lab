import { GitError } from "./errors.ts";
import type { RunGit } from "./run.ts";

export const MAX_STATUS_LINES = 200;
export const MAX_DIFF_CHARS = 12_000;
export const MAX_FILES = 300;

export type BranchInfo = Readonly<{
  /** `null` — HEAD отсоединён от ветки. */
  branch: string | null;
  /** `null` — в ветке ещё нет коммитов. */
  head: Readonly<{ sha: string; subject: string }> | null;
}>;

export type StatusInfo = Readonly<{ lines: readonly string[]; total: number; truncated: boolean }>;
export type DiffInfo = Readonly<{ stat: string; diff: string; totalChars: number; truncated: boolean }>;
export type FilesInfo = Readonly<{ files: readonly string[]; total: number; truncated: boolean }>;

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

export async function readDiff(
  runGit: RunGit,
  options: Readonly<{ staged: boolean; path?: string }>,
): Promise<DiffInfo> {
  // Внешний diff-драйвер и textconv из конфига репозитория запускают команды; при чтении они выключены.
  const base = ["diff", ...(options.staged ? ["--cached"] : []), "--no-ext-diff", "--no-textconv", "--no-color"];
  const stat = (await runGit([...base, "--stat", "--", pathspec(options.path)])).trimEnd();
  const full = await runGit([...base, "--", pathspec(options.path)]);
  const chars = [...full];
  return {
    stat,
    diff: chars.slice(0, MAX_DIFF_CHARS).join("").trimEnd(),
    totalChars: chars.length,
    truncated: chars.length > MAX_DIFF_CHARS,
  };
}

export async function listFiles(runGit: RunGit, path: string | undefined): Promise<FilesInfo> {
  const files = (await runGit(["ls-files", "-z", "--", pathspec(path)])).split("\0").filter(Boolean);
  return { files: files.slice(0, MAX_FILES), total: files.length, truncated: files.length > MAX_FILES };
}
