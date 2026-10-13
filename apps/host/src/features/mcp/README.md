# MCP: stdio-клиент для tool calling

## Назначение

`withStdioToolSource` запускает любой MCP-сервер по stdio на время одного вызова и передаёт в callback
`ToolSource` из core (`listTools`/`callTool`). Через него `ask` даёт модели инструменты серверов проекта.
Фича сервер-нейтральна: какие серверы запускать, решает composition root.

## Публичный контракт

`withStdioToolSource(options, use)` принимает `command`, `args`, обязательный `serverName` (метка для строк
`MCP:` и ошибок), `timeoutMs`, необязательные `env` и `callTimeoutsMs` (таймаут `callTool` по имени
инструмента). Клиент договаривается о современной ревизии протокола (`versionNegotiation.mode = "auto"`),
проверяет capability tools и отдаёт `use`:

- `listTools()` — полные `ToolDefinition`, включая `inputSchema`;
- `callTool()` — `ToolResult` с объединённым текстом блоков и `isError`; нетекстовые блоки — ошибка
  `UNSUPPORTED_TOOL_RESULT`.

Client закрывается в `finally`; ошибка из `use` (например, `AgentError`) проходит наружу без изменений.
`McpToolSourceError` несёт код, `server` и `stage` для `TIMEOUT` (`connect`/`listTools`/`callTool`).
Пользовательский текст ошибок формирует CLI.

## Окружение и песочница

`env` добавляется к безопасному набору переменных MCP SDK (`HOME`, `PATH` и т. п.); остальное окружение
host, включая ключи модели, дочерний процесс не получает. Фича не ограничивает инструменты сама: правило
«инструменты только читают» обеспечивают серверы проекта и ADR, см. корневой AGENTS.md.

## Настройки

`mcp.timeoutMs` — таймаут connect/listTools и вызовов без отдельного значения в `callTimeoutsMs`.

## Ограничения

Соединение создаётся на каждый вызов `ask` — постоянной сессии, кэша и переподключения нет. Лимит вызовов
за реплику держит Agent (`maxToolCalls`), не эта фича. Roots, resources, prompts и sampling не поддерживаются.

## Проверка

`tests/toolSource.test.ts` через подмену SDK проверяет согласование ревизии, listTools/callTool, объединение
текстовых блоков, `isError`, таймауты по стадиям и по имени инструмента, передачу `env`, `server` в ошибках и
порядок закрытия. Полная проверка проекта: `npm run check`.
