# Host

Рабочий пакет с CLI/REPL, агентом и фичей rag. `ask` отправляет одну реплику в DeepSeek без истории и без поиска по
документам; после `/rag on` в REPL реплики становятся чатом с RAG, историей последних ходов и памятью задачи. `rag ask` всегда
отвечает по найденным фрагментам без истории в режиме
`rag.retrievalMode` (по умолчанию `rewrite-filter`) и показывает источники и проверенные цитаты, `rag eval` сравнивает
четыре режима на контрольных вопросах, `rag citations` проверяет источники и цитаты в одном режиме, `rag dialog` прогоняет
сценарии чата и пишет `rag-dialog.md`, `rag calibrate`
подбирает порог сходства. `rag index`, `rag compare` и `rag calibrate` строят и оценивают индексы корпуса,
ключ DeepSeek им не нужен.

## Навигация

- `src/core` — Agent, ModelPort, ToolSource, AgentError, собственные тесты.
- `src/adapters/llm` — OpenAI-совместимый клиент с провайдерами DeepSeek и локальным сервером, перевод ошибок, тесты с подменённым fetch.
- `src/adapters/cli` — dispatch, чтение строк и CliView: оформление вывода и ошибок через styleText.
- `src/adapters/http` — HTTP-транспорт без знания о RAG: `listen`, чтение JSON-тела с потолком, формат ошибок, строка лога на запрос.
- `src/app` — запуск, composition root и режим сессии, реестры настроек и команд, системная инструкция, обработчики `ask`, `rag` (`index`, `compare`, `calibrate`), `rag ask`/`rag eval`/`rag citations` чат (`rag dialog`, диалог REPL) и RAG-сервис `rag serve` (сессии в памяти, обработчики HTTP).
- `src/features/rag` — индексация документов (корпус, чанкинг, эмбеддинги Ollama, `index.json`, сравнение стратегий), поиск по индексу, rewrite запроса, отбор по порогу, ответ с RAG, источники, проверка цитат и режим «не знаю», калибровка порога, контрольные вопросы и отчёты `rag eval` и `rag citations`, чат с историей и памятью задачи (`chat/`) и отчёт `rag dialog`.

Из корня репозитория: `npm run dev`, `npm run dev -- help`, `npm run dev -- rag index`, `npm run dev -- rag compare`,
`npm run dev -- rag calibrate`,
`npm run dev -- rag ask "вопрос"`, `npm run dev -- rag eval`, `npm run dev -- rag citations`, `npm run dev -- rag dialog`, `npm run dev -- rag serve`.
После сборки: `npm start -- help`. Скрипты читают корневой `.env`, если файл существует.
Публичный src/index.ts экспортирует Agent, типы порта и ошибки без запуска процесса.
Исполняемый вход — src/app/main.ts. Границы и развитие описаны в [ARCHITECTURE](../../ARCHITECTURE.md).
