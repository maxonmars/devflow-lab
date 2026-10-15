export type SupportErrorCode =
  | "DATA_UNREADABLE"
  | "DATA_TOO_LARGE"
  | "DATA_INVALID"
  | "TICKET_NOT_FOUND"
  | "USER_NOT_FOUND";

export class SupportDataError extends Error {
  readonly code: SupportErrorCode;

  constructor(code: SupportErrorCode) {
    super(code);
    this.name = "SupportDataError";
    this.code = code;
  }
}

/** Текст ошибки для модели и человека: причина без пути файла и стека. */
export function describeSupportError(error: unknown): string {
  if (!(error instanceof SupportDataError)) return "Не удалось прочитать данные поддержки.";
  switch (error.code) {
    case "DATA_UNREADABLE":
      return "Файл данных поддержки не прочитан.";
    case "DATA_TOO_LARGE":
      return "Файл данных поддержки слишком большой.";
    case "DATA_INVALID":
      return "Файл данных поддержки не является JSON или не соответствует схеме клиентов и тикетов.";
    case "TICKET_NOT_FOUND":
      return "Тикет с таким идентификатором не найден.";
    case "USER_NOT_FOUND":
      return "Клиент, указанный в тикете, не найден в данных поддержки.";
  }
}
