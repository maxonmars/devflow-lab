# Host

Рабочий пакет с CLI/REPL, агентом и фичами rag и mcp. `ask` отправляет одну реплику модели без истории и без поиска
по документам; модель может вызывать инструменты MCP-серверов, сессии которых открываются на эту реплику (git-сервер). `rag index` строит индекс документации проекта (`project.root`, `rag.include`), `rag ask` отвечает по
найденным фрагментам с источниками и проверенными цитатами в режиме `rag.retrievalMode`. `info <вопрос>` — ассистент
проекта: те же фрагменты плюс git-инструменты сервера `servers/git`, которые модель вызывает сама.

## Навигация

- `src/core` — Agent с циклом инструментов, ModelPort, ToolSource, AgentError, собственные тесты.
- `src/adapters/llm` — OpenAI-совместимый клиент с провайдерами DeepSeek и локальным сервером, перевод ошибок.
- `src/adapters/cli` — dispatch, чтение строк и CliView: оформление вывода и ошибок через styleText.
- `src/app` — запуск, composition root, реестры настроек и команд, системная инструкция, обработчики `ask`
  (MCP-сессии, объединение источников инструментов), `rag index`, `rag ask` и `info <вопрос>`, путь к входу сервера.
- `src/features/rag` — корпус проекта, чанкинг, эмбеддинги Ollama, `index.json`, поиск, rewrite, отбор, ответ с цитатами.
- `src/features/mcp` — stdio-клиент MCP (`withStdioToolSource`).

Из корня репозитория: `npm run dev`, `npm run dev -- help`, `npm run dev -- rag index`, `npm run dev -- rag ask "вопрос"`,
`npm run dev -- ask "вопрос"`, `npm run dev -- info "вопрос"`. После сборки: `npm start -- help`. Скрипты читают корневой `.env`, если файл существует.
Публичный src/index.ts экспортирует Agent, типы порта и ошибки без запуска процесса.
Исполняемый вход — src/app/main.ts. Границы и развитие описаны в [ARCHITECTURE](../../ARCHITECTURE.md).
