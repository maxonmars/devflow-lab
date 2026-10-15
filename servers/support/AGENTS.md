# support MCP server

Общие правила — в [корневом AGENTS.md](../../AGENTS.md) и [servers/README.md](../README.md).

- Самостоятельный npm workspace `@devflow-lab/support-server`. Не импортирует host и другие серверы.
- Один читающий инструмент `get_ticket`. Запись в JSON (статус, ответ в тикет), поиск клиентов, сеть и внешняя CRM —
  только через ADR с подтверждением человека.
- Читается только файл из `--data`; путь проверяет host (`support.dataFile` внутри `project.root`).
- Текст `get_ticket` host не разбирает: формат — для модели, не контракт. Схема файла — src/data/schema.ts.
- Лимиты — именованные константы (`MAX_DATA_CHARS`, `MAX_TICKET_MESSAGES`).
- `process`, argv — только в src/app/main.ts. stdout — только протокол MCP, логи — stderr. Окружение не нужно.
- Ошибки — `SupportDataError` с кодом; текст формирует `describeSupportError`, без пути файла и стека.
- Тесты: подменённый `ReadData` для разбора и формата, `InMemoryTransport` и настоящий `Client` для протокола.
