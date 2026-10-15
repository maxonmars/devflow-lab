import { describe, expect, it } from "vitest";
import {
  describeSupportError,
  findTicket,
  loadSupportData,
  MAX_DATA_CHARS,
  MAX_TICKET_MESSAGES,
  SupportDataError,
  ticketText,
  ticketView,
} from "../index.ts";
import { DATA, readJson } from "./fixtures.ts";

const failure = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(SupportDataError);
  return (error as SupportDataError).code;
};

describe("loadSupportData", () => {
  it("корректный файл проходит схему", async () => {
    expect(await loadSupportData(readJson(DATA))).toEqual(DATA);
  });

  it("ошибка чтения, не JSON, нарушение схемы и слишком большой файл — свои коды", async () => {
    expect(
      await failure(
        loadSupportData(async () => {
          throw new Error("ENOENT /secret/path");
        }),
      ),
    ).toBe("DATA_UNREADABLE");
    expect(await failure(loadSupportData(async () => "{ не json"))).toBe("DATA_INVALID");
    const badPlan = { ...DATA, users: [{ ...DATA.users[0], plan: "gold" }] };
    expect(await failure(loadSupportData(readJson(badPlan)))).toBe("DATA_INVALID");
    expect(await failure(loadSupportData(readJson({ users: [] })))).toBe("DATA_INVALID");
    expect(await failure(loadSupportData(async () => " ".repeat(MAX_DATA_CHARS + 1)))).toBe("DATA_TOO_LARGE");
  });
});

describe("findTicket", () => {
  it("находит тикет с клиентом; неизвестный тикет и клиент — разные причины", async () => {
    const data = await loadSupportData(readJson(DATA));
    expect(findTicket(data, "T-1").user.name).toBe("Анна");
    expect(() => findTicket(data, "T-404")).toThrow(expect.objectContaining({ code: "TICKET_NOT_FOUND" }));
    expect(() => findTicket(data, "T-2")).toThrow(expect.objectContaining({ code: "USER_NOT_FOUND" }));
  });

  it("текст ошибки называет причину без пути и стека", () => {
    expect(describeSupportError(new SupportDataError("TICKET_NOT_FOUND"))).toBe(
      "Тикет с таким идентификатором не найден.",
    );
    expect(describeSupportError(new Error("/secret/path"))).toBe("Не удалось прочитать данные поддержки.");
  });
});

describe("ticketView и ticketText", () => {
  it("переписка по времени, клиент со статусом аккаунта и способом входа", () => {
    const text = ticketText(ticketView(findTicket(DATA, "T-1")));
    expect(text).toContain("Тикет T-1: Не могу войти\nСтатус тикета: открыт (open)");
    expect(text).toContain("- Статус аккаунта: временно заблокирован (locked)");
    expect(text).toContain("- Способ входа: email и пароль (password)");
    expect(text.indexOf("клиент: Пишет")).toBeLessThan(text.indexOf("поддержка: Уточните"));
    expect(text).not.toContain("Показано");
  });

  it("длинная переписка обрезается до последних сообщений с отметкой", () => {
    const messages = Array.from({ length: MAX_TICKET_MESSAGES + 2 }, (_, i) => ({
      from: "user" as const,
      at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
      text: `сообщение ${i}`,
    }));
    const view = ticketView({ ticket: { ...DATA.tickets[0], messages }, user: DATA.users[0] });
    expect([view.messagesShown, view.messagesTotal]).toEqual([MAX_TICKET_MESSAGES, MAX_TICKET_MESSAGES + 2]);
    const text = ticketText(view);
    expect(text).not.toContain("сообщение 1\n");
    expect(text).toContain(`сообщение ${MAX_TICKET_MESSAGES + 1}`);
    expect(text.endsWith(`Показано ${MAX_TICKET_MESSAGES} из ${MAX_TICKET_MESSAGES + 2}.`)).toBe(true);
  });
});
