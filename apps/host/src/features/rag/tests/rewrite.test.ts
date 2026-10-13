import { describe, expect, it } from "vitest";
import { AgentError } from "../../../core/index.ts";
import { RagError } from "../errors.ts";
import { readPrompt } from "../prompts.ts";
import { rewriteQuery } from "../rewrite.ts";
import { fakeModel } from "./support.ts";

const failureOf = async (promise: Promise<unknown>): Promise<unknown> => promise.catch((error: unknown) => error);

describe("rewriteQuery", () => {
  it("отправляет один вызов: инструкция prompts/rewrite.md и вопрос, без истории и инструментов", async () => {
    const { model, requests } = fakeModel({ rewrite: () => "public API модуля" });
    expect(await rewriteQuery("  Слушай, как тут с public API?  ", model)).toBe("public API модуля");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.messages).toEqual([
      { role: "system", content: readPrompt("rewrite.md") },
      { role: "user", content: "Слушай, как тут с public API?" },
    ]);
    expect(requests[0]?.tools).toEqual([]);
  });

  it("убирает пробелы и перевод строки вокруг одной строки запроса", async () => {
    const { model } = fakeModel({ rewrite: () => "  запрос\n" });
    expect(await rewriteQuery("Вопрос", model)).toBe("запрос");
  });

  it("несколько строк — REWRITE_INVALID с причиной multiline, запрос не выделяется из ответа", async () => {
    const { model } = fakeModel({ rewrite: () => "Вот запрос:\nдеревья зависимостей" });
    const error = await failureOf(rewriteQuery("Вопрос", model));
    expect(error).toBeInstanceOf(RagError);
    expect(error).toMatchObject({ code: "REWRITE_INVALID", data: { reason: "multiline" } });
  });

  it("Markdown-забор — REWRITE_INVALID с причиной fence, забор не снимается", async () => {
    const { model, requests } = fakeModel({ rewrite: () => "```текст запроса```" });
    const error = await failureOf(rewriteQuery("Вопрос", model));
    expect(error).toMatchObject({ code: "REWRITE_INVALID", data: { reason: "fence" } });
    expect(requests).toHaveLength(1);
  });

  it("пустой ответ — AgentError EMPTY_RESPONSE, повторного вызова нет", async () => {
    const { model, requests } = fakeModel({ rewrite: () => "   " });
    const error = await failureOf(rewriteQuery("Вопрос", model));
    expect(error).toBeInstanceOf(AgentError);
    expect(error).toMatchObject({ code: "EMPTY_RESPONSE" });
    expect(requests).toHaveLength(1);
  });

  it("сбой модели остаётся собственной ошибкой модели, а не REWRITE_INVALID", async () => {
    const { model } = fakeModel({ failOn: { kind: "rewrite", call: 1 } });
    const error = await failureOf(rewriteQuery("Вопрос", model));
    expect(error).not.toBeInstanceOf(RagError);
    expect((error as Error).message).toBe("сбой модели");
  });

  it("инструкция запрещает отвечать на вопрос и выдумывать факты", () => {
    const instruction = readPrompt("rewrite.md");
    expect(instruction).toContain("одну строку");
    expect(instruction).toContain("Не отвечай на вопрос");
    expect(instruction).toContain("отрицания");
  });
});
