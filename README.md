# devflow-lab

Учебный репозиторий седьмой недели курса — AI в рабочем процессе разработчика. За неделю здесь появятся ассистент,
который понимает проект (RAG по документации и MCP-инструменты проекта), ревью PR в GitHub Actions, пайплайны и
субагенты; план — [docs/course.md](docs/course.md). Каркас собран из rag-lab и mcp-lab
([ADR 0001](docs/adr/0001-repository-foundation.md)). Сейчас готовы ассистент проекта `info <вопрос>`: он отвечает по
документации (RAG) и сам смотрит в git через MCP-сервер ([ADR 0002](docs/adr/0002-project-info.md)), — и AI-ревью PR
`review <база>`, которое GitHub Actions публикует комментарием в PR ([ADR 0003](docs/adr/0003-ai-review.md)).

## Запуск

```sh
nvm use
npm ci
npm run hooks:install
ollama pull bge-m3
npm run dev -- rag index
npm run dev -- info "Какая сейчас ветка и что в ней изменено?"
```

Ollama должна быть запущена (`ollama serve`) — [docs/ollama.md](docs/ollama.md). Ключ DeepSeek нужен для `ask`,
`rag ask`, `info <вопрос>` и `review <база>` при `llm.provider: deepseek`: `LAB_LLM_API_KEY` в корневом `.env` или окружении процесса. С
`--llm-provider local` те же команды идут в локальный OpenAI-совместимый сервер без ключа. Индекс лежит в
`.local/rag/index.json` (каталог `.local/` не попадает в git).

```sh
npm run dev -- help
npm run dev -- config show
npm run dev -- ask "Что такое MCP?"
npm run dev
```

## Ассистент проекта

`info <вопрос>` (в REPL — `/info вопрос`) ищет фрагменты документации проекта и даёт модели git-инструменты: ветку,
статус, diff (в том числе относительно базовой ветки), списки изменённых и отслеживаемых файлов, содержимое файла в
HEAD. Модель сама решает, что вызвать; каждый вызов печатается строкой `MCP: git › git_branch — выполнено`. Ответ содержит источники с проверенными цитатами и раздел «Данные проекта» с
фактами инструментов; если ответ дан только по данным git, пустые «Источники», «Цитаты» и «Фрагменты» не печатаются.
`help` (`--help`, `-h`) — обычная справка по командам и настройкам. Обычная строка REPL идёт в `ask`: у него есть
git-инструменты, но нет документации.

```sh
npm run dev -- info "Где лежат MCP-серверы и какие правила для их инструментов?"
npm run dev -- info "Какие файлы лежат в docs/adr?"
npm run dev -- --project-root ../rag-lab info "Какая ветка и как устроен шлюз локальной модели?"
```

## AI-ревью PR

`review <база>` сравнивает текущую ветку с базой (`base...HEAD`): git-сервер даёт список изменённых файлов, diff и
содержимое каждого файла в HEAD, RAG находит фрагменты документации по diff, модель один раз пишет разделы
«Потенциальные баги», «Архитектурные проблемы» и «Рекомендации». Внизу — «Контекст ревью»: база, файлы, фрагменты
документации и модель.

```sh
npm run dev -- review main
npm run dev -- --review-output-file .local/review.md review main
```

Workflow [ai-review.yml](.github/workflows/ai-review.yml) запускается на PR (`opened`, `synchronize`, `reopened`):
Ollama в раннере, `rag index`, `review "origin/<base>"`. Результат — один комментарий PR, который обновляется на каждый
push, и Job Summary. Нужен секрет репозитория `LAB_LLM_API_KEY`; PR из форков не ревьюятся.

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

`ask` и `info <вопрос>` открывают сессии MCP-серверов проекта на каждую реплику и дают модели их инструменты;
`review <база>` открывает ту же сессию и вызывает git-инструменты сам. Сейчас
сервер один — [git](servers/git/README.md) с корнем `project.root`; его инструменты только читают, не выходят за корень
и не видят игнорируемых файлов вроде `.env` ([правила серверов](servers/README.md)).

Настройки — YAML-файл, env (`LAB_…`) и флаги; приоритет и список — [docs/configuration.md](docs/configuration.md),
команды — [docs/commands.md](docs/commands.md). Пример файла — [lab.config.example.yaml](lab.config.example.yaml).

## Материалы

- [Архитектура](ARCHITECTURE.md), [правила для агентов](AGENTS.md), [ADR](docs/adr/README.md), [план недели](docs/course.md).
- [Фича rag](apps/host/src/features/rag/README.md) — контракт, формат индекса, ограничения.
- [Фича mcp](apps/host/src/features/mcp/README.md) — stdio-клиент и окружение серверов.
- [git MCP server](servers/git/README.md) — инструменты, песочница, ошибки.
- [Фича review](apps/host/src/features/review/README.md) — сообщение, промпт и итоговый Markdown ревью.
- Демо: [RAG по самому репозиторию](docs/demos/project-rag.md), [ассистент проекта](docs/demos/project-info.md),
  [AI-ревью PR](docs/demos/ai-review.md).

## Проверки

`npm run check` — lint, typecheck, границы зависимостей, структура и размеры, генерируемая документация, тесты с
coverage и сборка. Тот же набор запускают pre-commit (`npm run hooks:install`) и CI. Тесты не обращаются к сети и Ollama.
