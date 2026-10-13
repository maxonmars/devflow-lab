# Ollama: запуск, остановка, проверка

Ollama — локальный сервер моделей на `http://localhost:11434`. Он нужен только команде `rag index`; `rag compare`, `ask`,
`help` и `config show` его не используют. Без сервера `rag index` завершается сообщением «Ollama недоступна…».

## Что установлено на машине разработки

- Ollama.app через `brew install --cask ollama`: приложение `/Applications/Ollama.app`, команда `ollama` в PATH.
- Модель `bge-m3` (1,2 ГБ на диске) в `~/.ollama/models`.
- Автозапуска нет: пока вы не запустили сервер сами, он не работает.

## Проверить, работает ли

```sh
curl -s http://localhost:11434/api/version
```

Ответ `{"version":"0.34.4"}` — сервер работает, «connection refused» — не запущен.

```sh
ollama list
ollama ps
```

`list` показывает скачанные модели, `ps` — модели, загруженные в память сейчас.

## Включить

Через терминал — сервер живёт, пока открыто окно:

```sh
ollama serve
```

В фоне, с логом в файл:

```sh
ollama serve > /tmp/ollama.log 2>&1 &
```

Через приложение: `open -a Ollama`. Появляется значок в строке меню, сервер стартует вместе с приложением.

Запускайте что-то одно: оба способа занимают порт 11434, второй `ollama serve` завершится ошибкой
`address already in use`.

## Выключить

- терминал: Ctrl+C в окне с `ollama serve`;
- фон: `pkill -f "ollama serve"` (найти процесс: `pgrep -fl "ollama serve"`);
- приложение: значок в строке меню → Quit Ollama.

После остановки `curl` из раздела выше возвращает «connection refused».

## Модели и память

- После запроса модель остаётся в памяти 5 минут (`OLLAMA_KEEP_ALIVE`). Выгрузить сразу: `ollama stop bge-m3`.
  Для режима сервиса (шлюз `servers/llm-gateway`) сервер запускают как `OLLAMA_KEEP_ALIVE=30m ollama serve`: иначе первый запрос после простоя заново грузит 18 ГБ.
- Скачать: `ollama pull bge-m3` (нужно один раз). Удалить: `ollama rm bge-m3` — освободит около 1,2 ГБ.
- Удалить Ollama целиком: `brew uninstall --cask ollama`. Каталог `~/.ollama` (модели и ключ `id_ed25519`)
  остаётся; удалять его или нет — решает владелец, ключ в git не попадает.

## Работа с rag-lab

```sh
ollama serve                    # если ещё не запущена
ollama pull bge-m3              # один раз
npm run dev -- rag index
```

Быстрая проверка, что модель отвечает (ожидается `1024`):

```sh
curl -s http://localhost:11434/api/embed -d '{"model":"bge-m3","input":"Привет"}' | jq '.embeddings[0] | length'
```

| Сообщение `rag index` | Причина и действие |
|---|---|
| Ollama недоступна по … | Сервер не запущен или другой адрес: запустите `ollama serve` или задайте `rag.embeddingBaseUrl` |
| Модель … не найдена в Ollama | Выполните `ollama pull <модель>` |
| Ollama не ответила за rag.embeddingTimeoutMs | Первый запрос загружает модель; увеличьте `--rag-embedding-timeout-ms` |

Другой порт: `OLLAMA_HOST=127.0.0.1:11435 ollama serve` и `--rag-embedding-base-url=http://127.0.0.1:11435`.
