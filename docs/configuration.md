# Настройки

Генерируется из реестра: `npm run docs:generate`.

Приоритет: defaults < YAML-файл < env < CLI. Любой некорректный заданный источник отклоняется.
YAML содержит плоские ключи с точками. Секреты разрешены только в env; config.file недоступен внутри YAML.
`npm run dev` и `npm start` читают корневой `.env`, если он существует. Значения из окружения процесса имеют приоритет; config show показывает источник каждого значения.

| Ключ | Тип | Default | Env | Флаг | Описание |
|---|---|---|---|---|---|
| config.file | string | lab.config.yaml | LAB_CONFIG_FILE | --config-file | Путь к YAML-конфигурации относительно текущего рабочего каталога. |
| project.root | string | . | LAB_PROJECT_ROOT | --project-root | Корень проекта, о котором отвечает ассистент, относительно текущего рабочего каталога. По умолчанию — сам devflow-lab; можно указать соседний репозиторий. После смены корня индекс нужно пересобрать: `rag index`. |
| llm.provider | string | deepseek | LAB_LLM_PROVIDER | --llm-provider | Провайдер модели ответов и rewrite: `deepseek` — облачный API, `local` — локальный OpenAI-совместимый сервер (Ollama, LM Studio, `mlx_lm.server`). Эмбеддинги от провайдера не зависят и всегда идут в Ollama. |
| llm.model | string | deepseek-flash | LAB_LLM_MODEL | --llm-model | Идентификатор модели DeepSeek; используется при `llm.provider: deepseek`. |
| llm.timeoutMs | number | 30000 | LAB_LLM_TIMEOUT_MS | --llm-timeout-ms | Таймаут одного запроса к модели, миллисекунды. |
| llm.maxOutputTokens | number | 1024 | LAB_LLM_MAX_OUTPUT_TOKENS | --llm-max-output-tokens | Максимальное число токенов ответа; общий для обоих провайдеров. |
| llm.localBaseUrl | string | http://localhost:11434/v1 | LAB_LLM_LOCAL_BASE_URL | --llm-local-base-url | Адрес OpenAI-совместимого API локального сервера, вместе с `/v1`; используется при `llm.provider: local`. Ollama — `http://localhost:11434/v1`, LM Studio — `http://localhost:1234/v1`. |
| llm.localModel | string | qwen3 | LAB_LLM_LOCAL_MODEL | --llm-local-model | Имя локальной модели на сервере, например из `ollama list`. |
| llm.localTimeoutMs | number | 180000 | LAB_LLM_LOCAL_TIMEOUT_MS | --llm-local-timeout-ms | Таймаут одного запроса к локальной модели, миллисекунды; локальный вывод заметно медленнее облачного. |
| llm.apiKey | string | — | LAB_LLM_API_KEY | — | Ключ DeepSeek; принимается только из env, значение никогда не выводится. |
| llm.localApiKey | string | — | LAB_LLM_LOCAL_API_KEY | — | Ключ локального OpenAI-совместимого сервера, отправляется как Bearer при `llm.provider: local`; принимается только из env, значение не выводится. Без него отправляется заглушка — Ollama ключ не проверяет. |
| rag.include | string | README.md,AGENTS.md,ARCHITECTURE.md,docs/**/*.md,apps/*/README.md,apps/*/AGENTS.md,apps/*/src/**/README.md,servers/*/README.md | LAB_RAG_INCLUDE | --rag-include | Шаблоны glob через запятую относительно `project.root`: какие Markdown-файлы проекта входят в корпус. Шаблон не может быть абсолютным и не может содержать `..`; `node_modules`, `.git`, `dist`, `coverage` и `.local` пропускаются, символические ссылки тоже. Frontmatter необязателен: заголовок документа — первый H1 или имя файла. |
| rag.outputDir | string | .local/rag | LAB_RAG_OUTPUT_DIR | --rag-output-dir | Каталог индекса `index.json` относительно текущего рабочего каталога. |
| rag.chunkSizeChars | number | 1800 | LAB_RAG_CHUNK_SIZE_CHARS | --rag-chunk-size-chars | Максимальный размер чанка и окна fixed в кодовых точках Unicode. |
| rag.overlapChars | number | 200 | LAB_RAG_OVERLAP_CHARS | --rag-overlap-chars | Перекрытие соседних окон fixed и предел перекрытия из целых блоков в structure; строго меньше размера чанка. |
| rag.minChunkChars | number | 500 | LAB_RAG_MIN_CHUNK_CHARS | --rag-min-chunk-chars | Размер, ниже которого чанк structure объединяется с соседним, если вместе они не длиннее максимального; не больше размера чанка. |
| rag.embeddingBaseUrl | string | http://localhost:11434 | LAB_RAG_EMBEDDING_BASE_URL | --rag-embedding-base-url | Адрес сервера Ollama. |
| rag.embeddingModel | string | bge-m3 | LAB_RAG_EMBEDDING_MODEL | --rag-embedding-model | Имя модели эмбеддингов в Ollama; модель скачивается командой `ollama pull`. |
| rag.embeddingTimeoutMs | number | 120000 | LAB_RAG_EMBEDDING_TIMEOUT_MS | --rag-embedding-timeout-ms | Таймаут одного запроса эмбеддингов к Ollama, миллисекунды. |
| rag.chunkStrategy | string | structure | LAB_RAG_CHUNK_STRATEGY | --rag-chunk-strategy | Стратегия чанкинга, по чанкам которой ищет `rag ask`; индекс содержит обе: `fixed` и `structure`. |
| rag.retrievalMode | string | rewrite-filter | LAB_RAG_RETRIEVAL_MODE | --rag-retrieval-mode | Режим поиска в `rag ask`: `baseline` — top-K по исходному вопросу; `filter` — то же с порогом сходства; `rewrite` — поиск по переписанному моделью запросу; `rewrite-filter` — переписанный запрос и порог. |
| rag.answerPrompt | string | default | LAB_RAG_ANSWER_PROMPT | --rag-answer-prompt | Шаблон инструкции ответа: `default` — `prompts/answer.md`; `compact` — `prompts/answer-compact.md`, короче и со строгими правилами цитат, для локальной модели. Действует на `rag ask`. |
| rag.candidateTopK | number | 10 | LAB_RAG_CANDIDATE_TOP_K | --rag-candidate-top-k | Сколько кандидатов возвращает поиск до отбора, от 1 до 20; не меньше `rag.topK`. Порог отсекает слабый хвост среди кандидатов; при `rag.candidateTopK` больше `rag.topK` итоговая выдача фильтра сама по себе не меняется. |
| rag.topK | number | 5 | LAB_RAG_TOP_K | --rag-top-k | Конечный лимит: сколько чанков после порога передаётся модели, от 1 до 20; не больше `rag.candidateTopK`. |
| rag.similarityThreshold | number | 0.55 | LAB_RAG_SIMILARITY_THRESHOLD | --rag-similarity-threshold | Минимальное косинусное сходство чанка для режимов `filter` и `rewrite-filter`, число от -1 до 1; чанк со сходством, равным порогу, проходит. Порядок результатов не меняется. Значение по умолчанию 0.55 откалибровано в rag-lab на корпусе FEOD с `bge-m3`; для документации проекта порог не калибровался. |
| mcp.timeoutMs | number | 10000 | LAB_MCP_TIMEOUT_MS | --mcp-timeout-ms | Таймаут запуска MCP-сервера и одного вызова его инструмента, миллисекунды. |
