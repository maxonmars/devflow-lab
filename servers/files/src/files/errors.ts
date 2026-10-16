export type FilesErrorCode =
  | "GIT_NOT_FOUND"
  | "NOT_A_REPOSITORY"
  | "TIMEOUT"
  | "OUTPUT_TOO_LARGE"
  | "FILE_NOT_FOUND"
  | "NOT_A_FILE"
  | "OUTSIDE_ROOT"
  | "BINARY"
  | "TOO_LARGE"
  | "WRITE_FAILED"
  | "FAILED";

export class FilesError extends Error {
  readonly code: FilesErrorCode;
  /** Код завершения git; есть только у `FAILED`. */
  readonly exitCode: number | undefined;

  constructor(code: FilesErrorCode, exitCode?: number) {
    super(code);
    this.name = "FilesError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

/** Текст ошибки для модели: причина без stderr git и путей файловой системы. */
export function describeFilesError(error: unknown): string {
  if (!(error instanceof FilesError)) return "Не удалось выполнить операцию с файлом.";
  switch (error.code) {
    case "GIT_NOT_FOUND":
      return "Команда git не найдена на машине, где запущен сервер.";
    case "NOT_A_REPOSITORY":
      return "Корень проекта не находится внутри git-репозитория.";
    case "TIMEOUT":
      return "git не ответил за отведённое время.";
    case "OUTPUT_TOO_LARGE":
      return "Вывод git слишком большой; сузьте запрос путём.";
    case "FILE_NOT_FOUND":
      return "Файл не найден среди видимых файлов проекта (отслеживаемых и неотслеживаемых, но не игнорируемых).";
    case "NOT_A_FILE":
      return "Путь не указывает на обычный файл: каталоги и символические ссылки не поддерживаются.";
    case "OUTSIDE_ROOT":
      return "Файл находится за пределами корня проекта.";
    case "BINARY":
      return "Файл двоичный или не в кодировке UTF-8.";
    case "TOO_LARGE":
      return "Файл слишком большой для чтения.";
    case "WRITE_FAILED":
      return "Не удалось записать файл.";
    case "FAILED":
      return `git завершился с ошибкой (код ${error.exitCode ?? "неизвестен"}).`;
  }
}
