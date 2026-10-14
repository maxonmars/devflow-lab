import { expect, it } from "vitest";
import { describeGitError, GitError, type GitErrorCode } from "../index.ts";

it.each<[GitErrorCode, number | undefined, string]>([
  ["GIT_NOT_FOUND", undefined, "Команда git не найдена на машине, где запущен сервер."],
  ["NOT_A_REPOSITORY", undefined, "Корень проекта не находится внутри git-репозитория."],
  ["NO_COMMITS", undefined, "В репозитории ещё нет коммитов."],
  ["TIMEOUT", undefined, "git не ответил за отведённое время."],
  ["OUTPUT_TOO_LARGE", undefined, "Вывод git слишком большой; сузьте запрос путём."],
  ["UNKNOWN_REF", undefined, "Ref базы не найден в репозитории."],
  ["FILE_NOT_FOUND", undefined, "Файл не отслеживается в HEAD."],
  ["FAILED", 128, "git завершился с ошибкой (код 128)."],
  ["FAILED", undefined, "git завершился с ошибкой (код неизвестен)."],
])("%s → причина без stderr git", (code, exitCode, text) => {
  expect(describeGitError(new GitError(code, exitCode))).toBe(text);
});

it("посторонняя ошибка не раскрывает свой текст", () => {
  expect(describeGitError(new Error("/home/user/secret"))).toBe("Не удалось выполнить команду git.");
});
