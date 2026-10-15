# support MCP server

Читающий инструмент данных поддержки для ассистента поддержки (`support <тикет> <вопрос...>`,
[ADR 0004](../../docs/adr/0004-support-assistant.md)). Host запускает сервер по stdio на команду и передаёт путь к
JSON клиентов и тикетов: `node src/app/main.ts --data <project.root>/<support.dataFile>`.

## Инструмент

| Инструмент | Вход | Что возвращает |
|---|---|---|
| `get_ticket` | `id` (обязателен) | тема, статус и дата тикета; клиент: имя, email, тариф, статус аккаунта, способ входа, 2FA; переписка по времени, не больше 50 последних сообщений с отметкой «Показано N из M» |

`id` — от 1 до 40 символов `A-Z a-z 0-9 _ -`, первый — буква или цифра; иначе вызов отклоняет схема.
Результат — текст для модели и `structuredContent` по `outputSchema` (`ticket`, `user`, `messagesShown`,
`messagesTotal`). Текст host передаёт модели целиком и не разбирает, поэтому его формат — не контракт. Аннотации:
`readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`.

## Формат данных

```json
{
  "users": [{ "id", "name", "email", "plan": "free|pro|business", "accountStatus": "active|locked|suspended",
              "authMethod": "password|sso", "twoFactor": true }],
  "tickets": [{ "id", "userId", "subject", "status": "open|pending|closed", "createdAt": "ISO-8601",
                "messages": [{ "from": "user|support", "at": "ISO-8601", "text" }] }]
}
```

Схема — `src/data/schema.ts`. Пример —
[examples/support-product/support/tickets.json](../../examples/support-product/support/tickets.json).

## Песочница

- Сервер читает только один файл — путь из `--data`; host берёт его из `support.dataFile` внутри `project.root`.
- Файл читается на каждый вызов и только на чтение; записи, сети и запуска команд нет.
- Окружение серверу не нужно: host передаёт только `--data`, ключи модели не передаются.

## Ошибки

Ошибка возвращается результатом с `isError` и причиной: файл не прочитан, файл больше 1 000 000 символов, не JSON или не
по схеме, тикет не найден, клиент тикета не найден. Путь файла и стек в текст не попадают. Без `--data` или если путь не
указывает на файл, процесс завершается с кодом 2 и сообщением в stderr.

## Проверка

`src/tests`: `store.test.ts` — схема, ошибки чтения и разбора, поиск тикета и клиента, порядок и обрезка переписки;
`protocol.integration.test.ts` — `InMemoryTransport` и настоящий `Client`: список инструментов, текст тикета,
неизвестный и некорректный `id`, нечитаемые данные. Сборка проверяет список инструментов собранного сервера.
