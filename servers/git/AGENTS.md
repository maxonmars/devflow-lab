# git MCP server

Общие правила — в [корневом AGENTS.md](../../AGENTS.md) и [servers/README.md](../README.md).

- Самостоятельный npm workspace `@devflow-lab/git-server`. Не импортирует host и другие серверы.
- Только читающие инструменты: `git_branch`, `git_status`, `git_diff`, `list_files`, `git_changed_files`, `read_file`.
  Текст `git_changed_files` разбирает host (`review`): формат — контракт из README. Новый инструмент, который пишет
  в репозиторий или ходит в сеть, — только через ADR с подтверждением человека.
- git запускается только через `createGitRunner` (src/git/run.ts): без shell, с глобальными опциями песочницы.
- Лимиты — именованные константы в src/git/readers.ts; таймаут git короче таймаута MCP-вызова host.
- `process`, argv и env — только в src/app/main.ts. stdout — только протокол MCP, логи — stderr.
- Ошибки — `GitError` с кодом; текст для модели формирует `describeGitError`, без stderr git.
- Тесты: подменённый `RunGit` для разбора, временный репозиторий для настоящего git, `InMemoryTransport` для протокола.
