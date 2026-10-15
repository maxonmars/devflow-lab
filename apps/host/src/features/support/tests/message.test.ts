import { describe, expect, it } from "vitest";
import { renderSupportMessage } from "../message.ts";
import type { SupportInput } from "../types.ts";

const input = (overrides: Partial<SupportInput> = {}): SupportInput => ({
  ticketId: "T-1001",
  ticket: "Тикет T-1001: Не могу войти\nСтатус аккаунта: временно заблокирован (locked)",
  question: "Почему не работает авторизация?",
  docs: [
    { rank: 1, file: "docs/auth.md", title: "Вход", sections: ["Вход › Блокировка"], text: "Блокировка 30 минут." },
  ],
  ...overrides,
});

describe("renderSupportMessage", () => {
  it("документация, затем тикет в заборе, затем вопрос клиента", () => {
    const message = renderSupportMessage(input());
    const order = ["## Документация продукта", "### Фрагмент 1", "## Тикет T-1001", "## Вопрос клиента"];
    const positions = order.map((part) => message.indexOf(part));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(message).toContain("- Файл: `docs/auth.md`\n- Документ: Вход\n- Разделы: Вход › Блокировка");
    expect(message).toContain("## Тикет T-1001\n\n```text\nТикет T-1001: Не могу войти\n");
    expect(message.endsWith("## Вопрос клиента\n\nПочему не работает авторизация?")).toBe(true);
  });

  it("без документации — «Подходящих фрагментов нет.»", () => {
    expect(renderSupportMessage(input({ docs: [] }))).toContain(
      "## Документация продукта\n\nПодходящих фрагментов нет.\n\n## Тикет",
    );
  });

  it("забор тикета длиннее обратных кавычек в его тексте", () => {
    const message = renderSupportMessage(input({ ticket: "клиент прислал ```` и ```" }));
    expect(message).toContain("`````text\nклиент прислал ```` и ```\n`````");
  });
});
