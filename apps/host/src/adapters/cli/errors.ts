import { AgentError } from "../../core/index.ts";
import { McpToolSourceError } from "../../features/mcp/index.ts";
import { describeRagError, RagError } from "../../features/rag/index.ts";

export class InputError extends Error {}

export function describeError(error: unknown): string {
  if (error instanceof InputError) return error.message;
  if (error instanceof RagError) return describeRagError(error);
  if (error instanceof McpToolSourceError) return describeMcpToolSourceError(error);
  if (!(error instanceof AgentError)) return "Не удалось выполнить операцию.";
  switch (error.code) {
    case "EMPTY_INPUT":
      return "Введите непустую реплику.";
    case "EMPTY_RESPONSE":
      return "Модель вернула пустой ответ.";
    case "INCOMPLETE_RESPONSE":
      return error.data.reason === "length"
        ? "Ответ прерван по лимиту токенов. Настройки доступны в config show."
        : "Модель завершила генерацию без обычного ответа.";
    case "MODEL_FAILURE":
      return error.data.status ? `API вернул HTTP ${error.data.status}.` : "Запрос к модели не выполнен.";
    case "INVALID_TOOL_CALL_COUNT":
      return "Модель вернула ответ tool_calls без вызовов инструментов.";
    case "UNKNOWN_TOOL_CALL":
      return "Модель запросила неизвестный инструмент.";
    case "INVALID_TOOL_ARGUMENTS":
      return "Модель передала некорректные аргументы инструмента.";
    case "TOOL_CALL_LIMIT_EXCEEDED":
      return typeof error.data.limit === "number"
        ? `Модель превысила лимит вызовов инструментов за реплику (${error.data.limit}).`
        : "Модель превысила лимит вызовов инструментов за реплику.";
  }
}

function describeMcpToolSourceError(error: McpToolSourceError): string {
  const server = error.server;
  switch (error.code) {
    case "SERVER_START_FAILED":
      return `Не удалось запустить MCP-сервер «${server}».`;
    case "CONNECT_FAILED":
      return `Не удалось установить соединение с MCP-сервером «${server}».`;
    case "TOOLS_UNSUPPORTED":
      return `MCP-сервер «${server}» не объявил поддержку инструментов.`;
    case "LIST_TOOLS_FAILED":
      return `Не удалось получить список инструментов MCP-сервера «${server}».`;
    case "CALL_TOOL_FAILED":
      return `Не удалось выполнить вызов инструмента MCP-сервера «${server}».`;
    case "UNSUPPORTED_TOOL_RESULT":
      return `MCP-сервер «${server}» вернул неподдерживаемый формат результата.`;
    case "TIMEOUT":
      return `Истёк таймаут MCP-сервера «${server}» на стадии ${error.stage ?? "неизвестно"}.`;
    case "CLOSE_FAILED":
      return `Не удалось корректно закрыть соединение с MCP-сервером «${server}».`;
  }
}
