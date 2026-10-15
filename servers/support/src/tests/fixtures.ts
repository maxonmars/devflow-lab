import type { ReadData, SupportData } from "../index.ts";

export const DATA: SupportData = {
  users: [
    {
      id: "u-1",
      name: "Анна",
      email: "anna@example.com",
      plan: "pro",
      accountStatus: "locked",
      authMethod: "password",
      twoFactor: false,
    },
  ],
  tickets: [
    {
      id: "T-1",
      userId: "u-1",
      subject: "Не могу войти",
      status: "open",
      createdAt: "2026-10-12T09:00:00Z",
      messages: [
        { from: "support", at: "2026-10-12T10:00:00Z", text: "Уточните сообщение." },
        { from: "user", at: "2026-10-12T09:00:00Z", text: "Пишет «Аккаунт временно заблокирован»." },
      ],
    },
    {
      id: "T-2",
      userId: "u-404",
      subject: "Сирота",
      status: "closed",
      createdAt: "2026-10-12T09:00:00Z",
      messages: [],
    },
  ],
};

export const readJson =
  (value: unknown): ReadData =>
  async () =>
    JSON.stringify(value);
