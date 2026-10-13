# rag-lab

Учебный репозиторий пятой недели курса — RAG. Первое задание — индексация документов: русскоязычная документация
FEOD (32 файла, около 174 тыс. символов) режется на чанки двумя стратегиями, для чанков считаются эмбеддинги в
локальной Ollama, результат сохраняется в `index.json` вместе с метаданными, а `rag compare` сравнивает стратегии.
Второе задание — первый RAG-запрос: по вопросу ищутся ближайшие чанки, они склеиваются с вопросом и уходят в
DeepSeek; ответы без RAG и с RAG сравниваются на 10 контрольных вопросах. Третье — порог релевантности и переписывание
запроса: кандидаты фильтруются по cosine similarity, запрос для поиска переписывает DeepSeek, четыре режима поиска
сравниваются на 15 вопросах. Четвёртое — источники, цитаты и режим «не знаю»: ответ содержит источники и проверенные
цитаты, а при пустом отборе по порогу модель не вызывается; формат проверяется на 10 вопросах. Пятое — мини-чат с RAG:
в режиме `/rag on` реплики идут с историей и памятью задачи, `rag dialog` прогоняет два сценария. Каркас взят из mcp-lab
([ADR 0001](docs/adr/0001-repository-foundation.md)).

## Запуск

```sh
nvm use
npm ci
npm run hooks:install
npm run corpus:feod
ollama pull bge-m3
npm run dev -- rag index
npm run dev -- rag compare
```

Управление Ollama (включить, выключить, проверить, освободить память) — [docs/ollama.md](docs/ollama.md).

`corpus:feod` клонирует feod-docs в `.local/rag/source`, переключает на закреплённый коммит и собирает 32 документа в
`.local/rag/corpus`. Ollama должна быть запущена (`ollama serve`); `rag index` печатает ход по стратегиям в stderr.
Результаты — `.local/rag/index.json` и `.local/rag/comparison.md` (каталог `.local/` не попадает в git).
Ключ DeepSeek нужен для `ask`, `rag ask`, `rag eval`, `rag citations` и `rag dialog` при `llm.provider: deepseek`: `LAB_LLM_API_KEY` в корневом `.env` или окружении процесса. С `--llm-provider local` те же команды идут в локальный сервер без ключа ([демо](docs/demos/local-llm.md)).
`rag calibrate` ключа не требует.

```sh
npm run dev -- help
npm run dev -- config show
npm run dev -- --rag-chunk-size-chars=1200 --rag-min-chunk-chars=300 rag index
npm run dev -- ask "Что такое чанкинг?"
```

## Ответы с RAG

Нужны индекс (`rag index`), запущенная Ollama с той же моделью и ключ DeepSeek. `rag ask` всегда отвечает по найденным
фрагментам и печатает те, что получила модель; в REPL `/rag on` включает режим для обычных строк и `/ask`, `/rag off`
выключает (старт — без RAG). Поиск идёт по чанкам `rag.chunkStrategy` (`structure`) в режиме `rag.retrievalMode`
(по умолчанию `rewrite-filter`): DeepSeek переписывает вопрос в поисковый запрос, поиск возвращает `rag.candidateTopK`
(10) кандидатов, отбор оставляет чанки со сходством не ниже `rag.similarityThreshold` (0.55, выбран `rag calibrate`),
и не больше `rag.topK` (5) уходят в модель вместе с исходным вопросом. Ответ содержит источники (`chunk_id`, URL) и цитаты,
а код проверяет, что каждая цитата дословно есть в указанном фрагменте. Если отбор ничего не оставил, модель не вызывается:
ответ — «не знаю» с просьбой уточнить вопрос, а CLI пишет «Фрагменты: контекст пуст».

```sh
npm run dev -- rag calibrate --rag-questions-file experiments/feod-rag/questions.md
npm run dev -- rag ask "Что можно хранить в global?"
npm run dev -- --rag-retrieval-mode=baseline rag ask "Что можно хранить в global?"
npm run dev -- rag eval
npm run dev -- rag citations --rag-questions-file experiments/feod-citations/questions.md
npm run dev
```

`rag calibrate` подбирает порог без модели генерации и пишет `.local/rag/rag-calibration.md`; настройки он не меняет.
`rag eval` всегда сравнивает четыре режима на вопросах `rag.questionsFile` и пишет `.local/rag/rag-eval.md`.
`rag citations` прогоняет те же вопросы в режиме `rag.retrievalMode` и пишет `.local/rag/rag-citations.md` с проверкой
цитат. В REPL:
`/rag on` включает чат с историей и памятью задачи (`/rag state`, `/rag reset`), `/rag off` возвращает ответы без RAG; `rag dialog`
прогоняет сценарии чата и пишет `.local/rag/rag-dialog.md`.

Настройки — YAML-файл, env (`LAB_RAG_…`) и флаги; приоритет и список — [docs/configuration.md](docs/configuration.md),
команды — [docs/commands.md](docs/commands.md). Пример файла — [lab.config.example.yaml](lab.config.example.yaml).
`npm run dev:local` запускает приложение с профилем [lab.local.yaml](lab.local.yaml) на локальной модели — [демо](docs/demos/local-llm.md).
`npm run gateway` запускает [шлюз локальной модели](servers/llm-gateway/README.md) с ключом и лимитами для доступа по сети — [демо](docs/demos/local-service.md).
`npm run dev:local -- rag serve` поднимает RAG-чат как HTTP-сервис за тем же шлюзом ([ADR 0010](docs/adr/0010-rag-service.md)) — [демо](docs/demos/rag-service.md).

## Материалы

- [ADR 0002](docs/adr/0002-document-indexing.md) — решения индексации и выбор модели эмбеддингов.
- [ADR 0003](docs/adr/0003-first-rag-query.md) — поиск, режим RAG, контрольные вопросы.
- [ADR 0004](docs/adr/0004-relevance-filter-and-query-rewrite.md) — порог релевантности, rewrite, калибровка, сравнение режимов.
- [ADR 0005](docs/adr/0005-citations-and-refusal.md) — источники, цитаты, проверка дословности, режим «не знаю».
- [ADR 0006](docs/adr/0006-rag-chat-memory.md) — RAG-чат: история диалога, память задачи, сценарии проверки.
- [Фича rag](apps/host/src/features/rag/README.md) — контракт, формат индекса, ограничения.
- Демо [индексации](docs/demos/indexing.md), [RAG-запроса](docs/demos/rag-query.md),
  [режимов поиска](docs/demos/retrieval-modes.md), [цитат](docs/demos/citations.md) и [RAG-чата](docs/demos/rag-chat.md),
  эксперименты [feod-chunking](experiments/feod-chunking/README.md), [feod-rag](experiments/feod-rag/README.md),
  [feod-retrieval](experiments/feod-retrieval/README.md), [feod-citations](experiments/feod-citations/README.md) и
  [feod-chat](experiments/feod-chat/README.md) — воспроизведение и выводы.
- [Архитектура](ARCHITECTURE.md), [курс](docs/course.md), [правила для агентов](AGENTS.md).

## Проверки

`npm run check` — lint, typecheck, границы зависимостей, структура и размеры, генерируемая документация, тесты с
coverage и сборка. Тесты не обращаются к сети и Ollama.
