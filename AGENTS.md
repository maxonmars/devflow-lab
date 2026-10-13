# rag-lab

## Цель и текущий объём
Учебный репозиторий пятой недели курса — RAG. Каркас взят из mcp-lab: ядро (Agent, ModelPort), адаптер DeepSeek,
CLI, реестры настроек и команд, tooling. MCP-фичи и серверы не переносились (ADR 0001).
Реализована индексация документов (ADR 0002): корпус Markdown → чанки двумя стратегиями (fixed и structure)
→ локальные эмбеддинги Ollama → `index.json` с метаданными → отчёт сравнения стратегий (`rag index`, `rag compare`).
И первый RAG-запрос (ADR 0003): вопрос → top-K чанков одной стратегии чанкинга (линейный косинус) → Markdown-сообщение
→ DeepSeek; `rag ask`, режим сессии `/rag on|off`, контрольные вопросы.
Порог и переписывание запроса (ADR 0004): четыре режима поиска (`baseline`, `filter`, `rewrite`, `rewrite-filter`),
отбор кандидатов по cosine similarity, query rewrite через DeepSeek, `rag calibrate`, `rag eval` сравнивает четыре режима.
Источники, цитаты и «не знаю» (ADR 0005): ответ в Markdown-разделах, `[N]` раскрывается в чанк, цитаты проверяются на
дословность, пустой отбор даёт «не знаю» без вызова модели; `rag citations` пишет отчёт `rag-citations.md`.
RAG-чат с памятью (ADR 0006): в режиме `/rag on` реплика идёт с историей последних ходов и памятью задачи (цель, уточнения,
ограничения и термины), с источниками и цитатами; `rag state`, `rag reset`, `rag dialog` пишет отчёт `rag-dialog.md`.
Локальная модель (ADR 0007): `llm.provider` переключает ответы, rewrite и память задачи между DeepSeek и локальным
OpenAI-совместимым сервером; эмбеддинги всегда в Ollama. `rag citations` сравнивает провайдеров: показывает время этапов и ошибки модели, эксперимент feod-local-llm.
Оптимизация локальной модели (ADR 0008): Modelfile `rag-local-opt` и шаблон ответа `rag.answerPrompt`, эксперимент feod-local-tuning.
Локальная модель как приватный сервис (ADR 0009): шлюз `servers/llm-gateway` с Bearer-ключом, rate limit, очередью и лимитом контекста перед Ollama; `llm.localApiKey`, эксперимент feod-local-service.
RAG как приватный сервис (ADR 0010): `rag serve` за шлюзом, сессии диалога в памяти процесса. Диалог живёт только в памяти: сессии REPL или процесса `rag serve`. Специализированного реранкинга нет. Задания выдаются по одному;
docs/course.md — ориентир недели, он не разрешает реализовывать будущие задания заранее.
Перед заданием сформулируй учебную цель и минимальный результат; улучшения отдели явно.

## Карта
| Путь | Ответственность |
|---|---|
| apps/host/src/core | Agent, ModelPort, типизированные ошибки |
| apps/host/src/adapters/llm | DeepSeek через OpenAI-совместимый SDK |
| apps/host/src/adapters/cli | Ввод, dispatch, REPL, отображение ошибок |
| apps/host/src/adapters/http | HTTP-транспорт `rag serve`: `listen`, JSON-тело, формат ошибок, лог запроса |
| apps/host/src/app | Единственная композиция host, реестры, Markdown-инструкции |
| servers/llm-gateway | Шлюз перед Ollama: ключ, rate limit, параллельность, лимит контекста, прокси `/v1/chat/completions` и `/v1/rag/*`; `GATEWAY_*` читает только его `app/main.ts` |
| apps/host/src/features/rag | Индексация и RAG-запрос: корпус, чанкинг, эмбеддинги Ollama, индекс, сравнение, поиск, rewrite, отбор по порогу, ответ, цитаты и режим «не знаю», калибровка, контрольные вопросы, чат (`chat/`: диалог, память задачи, ход, сценарии) |
| experiments | Отчёты сравнений и контрольные вопросы: измерения, ручные оценки, выводы (feod-chunking, feod-rag, feod-retrieval, feod-citations, feod-chat, feod-local-llm, feod-local-tuning, feod-local-service) |
| docs/adr, docs/demos | Решения и короткие ручные демонстрации |
| tooling | Архитектурные проверки, документация, сборка, подготовка корпуса |

## Зависимости
app связывает core, адаптеры и публичные входы фич.
core не импортирует SDK, Node API, адаптеры, app или фичи.
Фича не импортирует другую фичу; снаружи доступен только её index.ts, тесты app не берут файлы из tests фичи.
Адаптер может реализовать публичный порт фичи; обратный импорт запрещён.
Специфический адаптер хранится внутри фичи (Ollama — в features/rag), общий — в adapters.
Один composition root на процесс. Регистрация явная, динамического поиска плагинов нет.
Текущие точки расширения — ModelPort и EmbeddingPort фичи rag. Новые контракты — через ADR.
Новая фича использует контракт; не добавляй ветвление по её имени в core.

## Глоссарий
- Корпус: набор Markdown-документов с frontmatter (`source`, `title`); подготовка — `npm run corpus:feod`.
- Чанк: непрерывный фрагмент документа; диапазон `start`–`end` в кодовых точках Unicode нормализованного текста.
- Стратегия чанкинга: fixed — окна с перекрытием; structure — по заголовкам и целым блокам Markdown.
- Индекс: `index.json` с документами, чанками обеих стратегий, эмбеддингами и параметрами построения.
- Эмбеддинг: вектор чанка от модели Ollama; EmbeddingPort — порт фичи rag, не ModelPort.
- Режим RAG: режим сессии REPL (`/rag on`, `/rag off`, старт — выключен); `/rag on` включает чат с настроенным конвейером, `rag ask` всегда отвечает с RAG без истории.
- Режим поиска (`rag.retrievalMode`): `baseline`, `filter`, `rewrite`, `rewrite-filter`; по умолчанию `rewrite-filter`.
- Кандидаты: результат поиска до отбора (`rag.candidateTopK`); порог — `rag.similarityThreshold`, отбор оставляет `score >= порог`.
- Контрольный вопрос: раздел `experiments/feod-retrieval/questions.md` с ожиданием и файлами-источниками корпуса; без источников — отрицательный.
- Цитата: строка `- [N] «текст»` в ответе; `[N]` — `rank` фрагмента в сообщении; засчитывается, если после нормализации это подстрока текста чанка.
- «Не знаю»: ответ без источников и цитат; при пустом отборе формирует код без вызова модели, иначе — модель.
- top-K: конечный лимит чанков, которые получает модель (`rag.topK`); стратегия чанкинга — `rag.chunkStrategy`.
- Диалог (`Dialog`): неизменяемый снимок сессии REPL или сессии `rag serve` — память задачи и ходы (`DialogTurn`: вопрос, запрос поиска, фрагменты, ответ, память после хода).
- Память задачи (`TaskState`): цель, уточнения, ограничения и термины; обновляется моделью до поиска, формат — Markdown-разделы.
- Окно истории (`rag.historyTurns`): сколько последних ходов уходит модели парами user/assistant.
- Провайдер модели (`llm.provider`): `deepseek` или `local`; не путать с моделью эмбеддингов (`rag.embeddingModel`, всегда Ollama).
- Шаблон ответа (`rag.answerPrompt`): `default` (`prompts/answer.md`) или `compact` (`answer-compact.md`); не путать с системным промптом.
- Agent: объект, обрабатывающий реплику через ModelPort; состояния не хранит, историю передаёт вызывающий. Command — команда CLI/REPL.
- Не называй разные понятия просто strategy или mode: стратегия чанкинга — `Strategy`, режим поиска — `RetrievalMode`.

## Конфигурация и команды
Реестр настроек: apps/host/src/app/settings.ts; описания: settings.md рядом.
Приоритет: defaults < YAML-файл < env < CLI. config show показывает источник.
Env и флаги выводятся из ключа. Секреты — только env, без значений в выводе и файлах.
process.env и process.argv читаются только в app/main.ts; дальше передаются явно.
Настройки шлюза `GATEWAY_*` — только env, читаются в `servers/llm-gateway/src/app/main.ts`; реестр host их не описывает.
Реестр команд: apps/host/src/app/commands.ts; один dispatch для CLI и REPL.
Справка и docs/configuration.md, docs/commands.md генерируются из реестров.
Лимиты — зарегистрированные настройки или именованные константы, не числа внутри циклов.

## Markdown и структура
Инструкции модели, заметки, отчёты — Markdown; метаданные — YAML frontmatter.
Структура допустима для API, схем, YAML-настроек и машинного состояния (`index.json`).
Не собирай смысловой контекст через JSON.stringify. System prompt — app/system.md, инструкции rag — features/rag/prompts/answer.md (ответ), rewrite.md (поисковый запрос), chat.md, rewrite-chat.md и task-state.md (чат).
Запись файла: временный рядом + rename. Это не межфайловая транзакция. Не добавляй хранилища и миграции без задания.
Корпус и результаты лежат в `.local/` (вне git); воспроизводимые таблицы и выводы — в experiments/.

## Guardrails и красные флаги
Перед фичей укажи контракт, папку, настройки, команды и тестируемый результат.
Нет подходящего контракта — остановись и предложи ADR, согласуй изменение ядра.
Обычная область PR: своя фича, composition root, документация; чужой код — с обоснованием.
Остановись и согласуй решение при if по фиче в ядре, расширении общего порта ради одной фичи,
импорте соседней фичи, обходе реестров, ручной справке, UI-тексте в ядре или промпте в TS/JSON.
dependency-cruiser проверяет границы, циклы и import type.
Пределы: 300 строк кода в файле, 400 в тесте, 60 в функции, 120 физических строк в AGENTS.md.
Исключение размера функции — только контейнер describe; it, hooks и helpers проверяются.
Фича содержит README.md, index.ts и tests/*.test.ts. prompts/ — только по необходимости.
Обход проверки или исключение требуют отдельного ADR; существующего allowlist нет.
Тесты без внешних API: fake EmbeddingPort и ModelPort, подменённый fetch, временные каталоги.
Документация на русском. Комментарий — 1–2 строки о неочевидном факте; старые не переписывай без просьбы.
Устаревшие факты исправляй на месте. Причины ошибок и названия тестов должны быть точными.

## Definition of Done
- Минимальная цель задания выполнена; будущие направления не реализованы попутно.
- Содержательные тесты и npm run check проходят; границы не ослаблены.
- Документация и генерируемая справка актуальны; секреты не попали в файлы и вывод.
- Для наблюдаемого поведения есть короткое воспроизводимое демо в docs/demos.
- Измерения отделены от оценок и симуляций; ограничения названы явно (одиночный прогон, источник чисел).

## Команды разработки
Node 24; npm ci; npm run hooks:install; npm run dev; npm run dev -- help; npm run dev:local — профиль lab.local.yaml (локальная модель); npm run gateway — шлюз локальной модели.
npm run corpus:feod; npm run dev -- rag index; npm run dev -- rag compare.
npm run dev -- rag calibrate; npm run dev -- rag ask "вопрос"; npm run dev -- rag eval; npm run dev -- rag citations; npm run dev -- rag dialog; npm run dev:local -- rag serve; в REPL — /rag on, /rag off, /rag state, /rag reset.
npm run lint; npm run typecheck; npm test; npm run test:coverage; npm run build.
npm run check; npm run check:deps; npm run check:structure; npm run docs:generate.

## Подробности
[README](README.md) · [Архитектура](ARCHITECTURE.md) · [ADR](docs/adr/README.md).
[Host](apps/host/README.md) · [Правила фич](apps/host/src/features/README.md) · [Курс](docs/course.md).
Локальные правила — во вложенном AGENTS.md; рядом всегда CLAUDE.md с @AGENTS.md.
