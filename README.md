# devflow-lab

Учебный репозиторий седьмой недели курса — AI в рабочем процессе разработчика. За неделю здесь появятся ассистент,
который понимает проект (RAG по документации и MCP-инструменты проекта), ревью PR в GitHub Actions, пайплайны и
субагенты; план — [docs/course.md](docs/course.md). Каркас собран из rag-lab и mcp-lab
([ADR 0001](docs/adr/0001-repository-foundation.md)): RAG по документации проекта и `ask` с циклом MCP-инструментов.

## Запуск

```sh
nvm use
npm ci
npm run hooks:install
ollama pull bge-m3
npm run dev -- rag index
npm run dev -- rag ask "Какие проверки входят в npm run check?"
```

Ollama должна быть запущена (`ollama serve`) — [docs/ollama.md](docs/ollama.md). Ключ DeepSeek нужен для `ask` и
`rag ask` при `llm.provider: deepseek`: `LAB_LLM_API_KEY` в корневом `.env` или окружении процесса. С
`--llm-provider local` те же команды идут в локальный OpenAI-совместимый сервер без ключа. Индекс лежит в
`.local/rag/index.json` (каталог `.local/` не попадает в git).

```sh
npm run dev -- help
npm run dev -- config show
npm run dev -- ask "Что такое MCP?"
npm run dev
```

## RAG по документации проекта

`rag index` собирает корпус из Markdown-файлов `rag.include` внутри `project.root`: по умолчанию это сам репозиторий —
README, AGENTS.md, ARCHITECTURE.md, `docs/**` (включая ADR и сгенерированные справочники команд и настроек), README
пакетов и фич. Чанки режутся по заголовкам и блокам Markdown, эмбеддинги считает Ollama (`bge-m3`). `rag ask` ищет
фрагменты в режиме `rag.retrievalMode` (по умолчанию `rewrite-filter`: запрос переписывает модель, отбор по порогу 0.55)
и отвечает с источниками и проверенными цитатами; если отбор пуст — «не знаю» без вызова модели.

Другой проект — флагом или настройкой; после смены корня индекс пересобирается:

```sh
npm run dev -- --project-root ../rag-lab rag index
npm run dev -- --project-root ../rag-lab rag ask "Как устроен шлюз локальной модели?"
```

## MCP

`ask` открывает сессии MCP-серверов проекта на каждую реплику и даёт модели их инструменты (до 6 вызовов за реплику);
каждый вызов печатается строкой `MCP: сервер › инструмент — выполнено`. Серверов пока нет — они появляются в `servers/`
по заданиям; инструменты по умолчанию только читают ([правила](servers/README.md)).

Настройки — YAML-файл, env (`LAB_…`) и флаги; приоритет и список — [docs/configuration.md](docs/configuration.md),
команды — [docs/commands.md](docs/commands.md). Пример файла — [lab.config.example.yaml](lab.config.example.yaml).

## Материалы

- [Архитектура](ARCHITECTURE.md), [правила для агентов](AGENTS.md), [ADR](docs/adr/README.md), [план недели](docs/course.md).
- [Фича rag](apps/host/src/features/rag/README.md) — контракт, формат индекса, ограничения.
- [Фича mcp](apps/host/src/features/mcp/README.md) — stdio-клиент и окружение серверов.
- [Демо: RAG по самому репозиторию](docs/demos/project-rag.md).

## Проверки

`npm run check` — lint, typecheck, границы зависимостей, структура и размеры, генерируемая документация, тесты с
coverage и сборка. Тот же набор запускают pre-commit (`npm run hooks:install`) и CI. Тесты не обращаются к сети и Ollama.
