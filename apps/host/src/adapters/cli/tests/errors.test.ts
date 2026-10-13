import { expect, it } from "vitest";
import { AgentError } from "../../../core/index.ts";
import { RagError } from "../../../features/rag/index.ts";
import { describeError, InputError } from "../index.ts";

it("указывает лимит токенов только при finish_reason length", () => {
  expect(describeError(new AgentError("INCOMPLETE_RESPONSE", { reason: "length" }))).toContain("лимиту токенов");
  expect(describeError(new AgentError("INCOMPLETE_RESPONSE", { reason: "content_filter" }))).not.toContain("лимит");
});

it("показывает безопасную причину, но не текст неизвестной ошибки", () => {
  expect(describeError(new InputError("Неверный флаг"))).toBe("Неверный флаг");
  expect(describeError(new AgentError("MODEL_FAILURE", { status: 429 }))).toBe("API вернул HTTP 429.");
  expect(describeError(new AgentError("MODEL_FAILURE"))).toBe("Запрос к модели не выполнен.");
  expect(describeError(new Error("secret"))).not.toContain("secret");
});

it("переводит коды Agent для tool calling", () => {
  expect(describeError(new AgentError("INVALID_TOOL_CALL_COUNT"))).toContain("без вызовов инструментов");
  expect(describeError(new AgentError("UNKNOWN_TOOL_CALL"))).toContain("неизвестный инструмент");
  expect(describeError(new AgentError("INVALID_TOOL_ARGUMENTS"))).toContain("некорректные аргументы");
  expect(describeError(new AgentError("TOOL_CALL_LIMIT_EXCEEDED", { limit: 6 }))).toBe(
    "Модель превысила лимит вызовов инструментов за реплику (6).",
  );
  expect(describeError(new AgentError("TOOL_CALL_LIMIT_EXCEEDED"))).toBe(
    "Модель превысила лимит вызовов инструментов за реплику.",
  );
});

it("переводит ошибки RAG на русский без текста провайдера", () => {
  expect(describeError(new RagError("INDEX_NOT_FOUND"))).toContain("rag index");
  expect(describeError(new RagError("MODEL_NOT_FOUND", { model: "bge-m3" }))).toContain("ollama pull bge-m3");
});
