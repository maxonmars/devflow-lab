# files MCP server

Общие правила — в [корневом AGENTS.md](../../AGENTS.md) и [servers/README.md](../README.md).

- Самостоятельный npm workspace `@devflow-lab/files-server`. Не импортирует host и другие серверы.
- Инструменты: `files_search`, `files_read` (читают) и `files_write` (единственная запись в репозиторий проекта).
  `files_write` заменяет только существующий видимый `.md`; host вызывает его после подтверждения человека и
  скрывает от модели (ADR 0005). Расширять запись — только через новый ADR.
- Видимые файлы определяет git: `ls-files --cached --others --exclude-standard`; игнорируемые не читаются и не пишутся.
  Проверки пути — `resolveVisibleFile` (src/files/readers.ts): видимость, обычный файл без symlink, `realpath` в корне.
- git запускается только через `createGitRunner` (src/files/run.ts): без shell, с глобальными опциями песочницы.
- Запись — временный файл рядом и `rename`. Лимиты — именованные константы в src/files.
- `process`, argv и env — только в src/app/main.ts. stdout — только протокол MCP, логи — stderr.
- Ошибки — `FilesError` с кодом; текст для модели формирует `describeFilesError`, без stderr git и путей.
- Тесты: подменённый `RunGit` для разбора, временный репозиторий для настоящего git, `InMemoryTransport` для протокола.
