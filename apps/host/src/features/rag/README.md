# Фича rag: индекс документации проекта, поиск, ответ с источниками и цитатами

Собирает корпус из Markdown-файлов проекта (`project.root` + шаблоны `rag.include`), режет его по заголовкам и блокам,
получает эмбеддинги через Ollama и сохраняет `index.json`. Поиск находит кандидатов по вопросу, отбор оставляет их по
порогу сходства, `answerWithRag` склеивает итоговые чанки с исходным вопросом и отправляет модели. Ответ разбирается
в `CitedAnswer`: текст, источники и цитаты, проверенные на дословность; при пустом отборе модель не вызывается, ответ —
«не знаю». Код перенесён из rag-lab без чата, отчётов и калибровки ([ADR 0001](../../../../../docs/adr/0001-repository-foundation.md)).

## Публичный контракт (`index.ts`)

- `indexCorpus({ projectRoot, include, outputFile, params, embeddings })` — корпус → чанки → эмбеддинги → `index.json`.
  Индекс заменяется целиком после успеха всех запросов; при ошибке прежний файл остаётся. Возвращает счётчики, токены
  и время (`stats`).
- `openIndex({ indexFile, embeddings })` — читает индекс один раз и проверяет digest модели эмбеддингов; возвращает
  `SearchIndex` с `search(question, topK)`: эмбеддинг вопроса → косинусная близость по всем чанкам → `SearchHit[]`
  (`rank` с 1, `score`, чанк без вектора).
- `answerWithRag({ question, index, mode, candidateTopK, topK, threshold, model, systemPrompt, answerPrompt })` — rewrite
  (по режиму) → поиск `candidateTopK` кандидатов → отбор → ответ `Agent`; системная инструкция вызывающего дополняется
  шаблоном `prompts/answer.md` или `answer-compact.md`. Пустой вопрос — `AgentError EMPTY_INPUT`, несогласованные
  параметры — `INVALID_RETRIEVAL_PARAMS`, оба до rewrite и поиска. Возвращает `answer`, итоговые `hits`, `contextChars`,
  строку поиска `query`, исходные `candidates` и длительности этапов `timings`.
  Необязательные `tools` (`ProjectTools`: `source` и `maxToolCalls`) включают ответ с инструментами проекта (ниже).
- `searchQueries({ index, queries, candidateTopK, topK, threshold })` — поиск по нескольким запросам без rewrite и
  генерации (`review`): по очереди `search(query, candidateTopK)` для каждого непустого запроса, порог `score >= threshold`,
  объединение по `chunk_id` с максимальным score, сортировка по убыванию (при равенстве — порядок первого появления),
  первые `topK` с рангами от 1. Пустой список запросов — `[]` без эмбеддингов; параметры проверяются до поиска.
- `renderCitedAnswer(answer)`, `describeCitationProblem(problem)` — текст ответа для CLI и русские описания замечаний.
- `ANSWER_PROMPTS`, `RETRIEVAL_MODES`, `checkRetrievalParams`, `MAX_TOP_K`, `SIMILARITY_RANGE`, `usesFilter` — режимы и
  единственная проверка параметров поиска.
- `EmbeddingPort` — `embed(texts)` и `describeModel()`; `createOllamaEmbeddings(options)` — адаптер Ollama `/api/embed`
  и `/api/tags` с внедряемым `fetch`.
- `RagError`, `describeRagError` — типизированные ошибки и русские сообщения для CLI.

## Корпус

`loadCorpus(root, include)` выбирает файлы `globSync` внутри `root`, оставляет только обычные `.md` (символические
ссылки пропускаются), убирает повторы и сортирует пути — от порядка зависят `corpusHash` и `chunk_id`. Каталоги
`node_modules`, `.git`, `dist`, `coverage` и `.local` не читаются. Frontmatter необязателен: без него `source` —
относительный путь, `title` — первый H1 или имя файла. Шаблоны вне корня отклоняет схема настройки `rag.include`.

## Чанкинг

Одна стратегия — по заголовкам и целым блокам Markdown. Чанк закрывается перед заголовком, если он не короче
`rag.minChunkChars`, или когда следующий блок не помещается в `rag.chunkSizeChars`; во втором случае следующий чанк
начинается с целых последних блоков предыдущего суммой не больше `rag.overlapChars`. Чанк короче минимума
присоединяется к предыдущему. Блок длиннее лимита режется окнами фиксированного размера с перекрытием. `chunk_id` — `файл#NNN-hash8`, где хеш
зависит от текста документа, параметров и диапазона.

## Режимы поиска и отбор

| Режим | Строка поиска | Порог |
|---|---|---|
| `baseline` | исходный вопрос | нет |
| `filter` | исходный вопрос | да |
| `rewrite` | переписанный запрос | нет |
| `rewrite-filter` | переписанный запрос | да |

Отбор — чистая функция над готовым списком: при фильтре оставляет `score >= порог`, затем берёт первые `topK`; порядок
и score не меняются, это не реранкинг. Rewrite — один вызов `Agent` с `prompts/rewrite.md`; ответ должен быть одной
строкой, иначе `REWRITE_INVALID`. В генерацию всегда идёт исходный вопрос.

## Формат `index.json` (`formatVersion: 2`)

| Поле | Содержимое |
|---|---|
| `createdAt`, `corpusHash` | время построения; sha256 от списка файлов и хешей их текста |
| `params` | `chunkSizeChars`, `overlapChars`, `minChunkChars` |
| `model`, `modelLoadMs` | `name`, `digest`, `dimension`; `load_duration` прогрева |
| `documents[]` | `file`, `source`, `title`, `hash`, `text` (нормализованный), `blocks[]` (`type`, `start`, `end`, `section`) |
| `stats` | `chunkingMs`, `embeddingMs`, `promptTokens` |
| `chunks[]` | `chunk_id`, `source`, `title`, `file`, `sections[]`, `start`, `end`, `text`, `embedding` |

Диапазоны `start`–`end` — кодовые точки Unicode: `text` равен срезу `documents[].text` по диапазону.

## Ответ и цитаты

`renderRagMessage` собирает Markdown: `## Фрагменты документации`, по разделу `### Фрагмент N` (файл, документ,
разделы, текст в заборе), затем `## Вопрос`. Шаблон ответа требует разделы `## Ответ`, `## Источники`, `## Цитаты` либо
`## Не знаю` и `## Уточнение`. `parseCitedAnswer` раскрывает `[N]` в чанк по `rank`; цитата засчитывается, если после
нормализации она — подстрока текста указанного чанка (не короче 20 символов). Нарушения формата возвращаются в
`problems`, модель повторно не вызывается.

## Ответ с инструментами проекта

С `tools` (ADR 0002) инструкция — `prompts/project.md` вместо шаблона ответа: устройство проекта берётся из фрагментов,
текущее состояние репозитория — из инструментов, которые модель вызывает сама (не больше `maxToolCalls`). Модель
вызывается и при пустом отборе; в сообщении тогда «Подходящих фрагментов нет». Ответ может содержать раздел
`## Данные проекта` со строками `- инструмент: факт`. `CitedAnswer.projectData` хранит эти строки с признаком `called`:
вызывался ли инструмент в этом ответе; если нет — замечание `tool-not-called`. Ответ только по данным инструментов не
требует источников и цитат, и `renderCitedAnswer` не печатает для него пустые «Источники» и «Цитаты». Без `tools`
раздел «Данные проекта» — лишний, поведение `rag ask` прежнее.

## Настройки и команды

`project.root`, `rag.include`, `rag.outputDir`, `rag.chunkSizeChars` (1800), `rag.overlapChars` (200),
`rag.minChunkChars` (500), `rag.embeddingBaseUrl`, `rag.embeddingModel` (`bge-m3`), `rag.embeddingTimeoutMs`,
`rag.retrievalMode` (`rewrite-filter`), `rag.answerPrompt`, `rag.candidateTopK` (10), `rag.topK` (5),
`rag.similarityThreshold` (0.55) — [docs/configuration.md](../../../../../docs/configuration.md).
Команды `rag index`, `rag ask` и `info <вопрос>` — [docs/commands.md](../../../../../docs/commands.md).

## Ограничения

- Порог 0.55 откалиброван в rag-lab на корпусе FEOD с `bge-m3`; для документации проекта не калибровался.
- После смены `project.root`, `rag.include` или параметров чанкинга индекс нужно пересобрать: сам индекс их не сверяет.
- Только `.md`; схемы и API-описания в других форматах в корпус не входят.
- Поиск — линейный перебор, индекс читается целиком на каждый `rag ask`; при другой модели эмбеддингов поиск отказывает.
- Размеры в кодовых точках, не в токенах. Нормализация цитаты не распознаёт перефразирование.
- Факт из «Данных проекта» сверяется только по имени инструмента, не по его результату.

## Проверка

`npm test` — тесты без сети: fake EmbeddingPort, подменённый fetch, временные каталоги. Ручной прогон —
[docs/demos/project-rag.md](../../../../../docs/demos/project-rag.md).
