import { type ExecFileException, execFile } from "node:child_process";
import { GitError } from "./errors.ts";

/** Запускает git с аргументами внутри корня проекта и возвращает stdout; ошибки — только `GitError`. */
export type RunGit = (args: readonly string[]) => Promise<string>;

export type GitRunnerOptions = Readonly<{
  root: string;
  env: Readonly<Record<string, string>>;
  timeoutMs?: number;
}>;

/** Короче таймаута MCP-вызова host (`mcp.timeoutMs`, 10 с): медленный git возвращается модели как `isError`. */
export const GIT_TIMEOUT_MS = 5000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

// fsmonitor из конфига репозитория запускает произвольную команду даже на чтении; literal-pathspecs выключает магию `:(…)`.
const GLOBAL_OPTIONS = [
  "--no-optional-locks",
  "--literal-pathspecs",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.quotepath=false",
];

function toGitError(error: ExecFileException, stderr: string): GitError {
  if (error.code === "ENOENT") return new GitError("GIT_NOT_FOUND");
  if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return new GitError("OUTPUT_TOO_LARGE");
  if (error.killed) return new GitError("TIMEOUT");
  if (/not a git repository/i.test(stderr)) return new GitError("NOT_A_REPOSITORY");
  if (/does not exist in 'HEAD'|exists on disk, but not in 'HEAD'/.test(stderr)) return new GitError("FILE_NOT_FOUND");
  if (/does not have any commits|ambiguous argument 'HEAD'|bad default revision 'HEAD'/i.test(stderr)) {
    return new GitError("NO_COMMITS");
  }
  return new GitError("FAILED", typeof error.code === "number" ? error.code : undefined);
}

export function createGitRunner(options: GitRunnerOptions): RunGit {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(
        "git",
        ["-C", options.root, ...GLOBAL_OPTIONS, ...args],
        {
          env: { ...options.env },
          timeout: options.timeoutMs ?? GIT_TIMEOUT_MS,
          maxBuffer: MAX_OUTPUT_BYTES,
          encoding: "utf8",
        },
        (error, stdout, stderr) => (error ? reject(toGitError(error, stderr)) : resolve(stdout)),
      );
    });
}
