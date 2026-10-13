export type GitErrorCode =
  | "GIT_NOT_FOUND"
  | "NOT_A_REPOSITORY"
  | "NO_COMMITS"
  | "TIMEOUT"
  | "OUTPUT_TOO_LARGE"
  | "FAILED";

export class GitError extends Error {
  readonly code: GitErrorCode;
  /** Код завершения git; есть только у `FAILED`. */
  readonly exitCode: number | undefined;

  constructor(code: GitErrorCode, exitCode?: number) {
    super(code);
    this.name = "GitError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

/** Текст ошибки для модели: причина без stderr git и путей файловой системы. */
export function describeGitError(error: unknown): string {
  if (!(error instanceof GitError)) return "Не удалось выполнить команду git.";
  switch (error.code) {
    case "GIT_NOT_FOUND":
      return "Команда git не найдена на машине, где запущен сервер.";
    case "NOT_A_REPOSITORY":
      return "Корень проекта не находится внутри git-репозитория.";
    case "NO_COMMITS":
      return "В репозитории ещё нет коммитов.";
    case "TIMEOUT":
      return "git не ответил за отведённое время.";
    case "OUTPUT_TOO_LARGE":
      return "Вывод git слишком большой; сузьте запрос путём.";
    case "FAILED":
      return `git завершился с ошибкой (код ${error.exitCode ?? "неизвестен"}).`;
  }
}
