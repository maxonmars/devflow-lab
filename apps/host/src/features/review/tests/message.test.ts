import { describe, expect, it } from "vitest";
import { renderReviewMessage } from "../message.ts";
import type { ReviewInput } from "../types.ts";

const DOC = {
  rank: 1,
  file: "AGENTS.md",
  title: "devflow-lab",
  sections: ["Зависимости"],
  text: "Фича не импортирует другую.",
};

const input = (overrides: Partial<ReviewInput> = {}): ReviewInput => ({
  base: "origin/main",
  files: [
    {
      path: "a.ts",
      status: "M",
      diff: "+const x = 1;",
      content: "Файл a.ts в HEAD (13 символов):\n```\nconst x = 1;\n```",
    },
    { path: "old.ts", status: "D", diff: "-удалено" },
    { path: "new.ts", status: "R", from: "prev.ts", diff: "+код с ```` внутри", content: "содержимое new.ts" },
  ],
  omitted: [],
  docs: [DOC],
  ...overrides,
});

describe("renderReviewMessage", () => {
  it("документация, затем изменения по файлам; удалённый файл — только diff", () => {
    const message = renderReviewMessage(input());
    const order = ["## Документация проекта", "### Фрагмент 1", "## Изменения относительно origin/main", "### M a.ts"];
    const positions = order.map((part) => message.indexOf(part));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(message).toContain("- Файл: `AGENTS.md`\n- Документ: devflow-lab\n- Разделы: Зависимости");
    expect(message).toContain("### D old.ts\n\n```diff\n-удалено\n```\n\n### R new.ts (из prev.ts)");
    expect(message).not.toContain("Не вошло в контекст");
  });

  it("забор diff длиннее обратных кавычек в коде", () => {
    expect(renderReviewMessage(input())).toContain("`````diff\n+код с ```` внутри\n`````\n\nсодержимое new.ts");
  });

  it("без документации — «Подходящих фрагментов нет», пропущенные файлы перечислены в конце", () => {
    const message = renderReviewMessage(input({ docs: [], omitted: ["big.ts", "more.ts"] }));
    expect(message).toContain("## Документация проекта\n\nПодходящих фрагментов нет.");
    expect(message.endsWith("## Не вошло в контекст\n\n- big.ts\n- more.ts")).toBe(true);
  });
});
