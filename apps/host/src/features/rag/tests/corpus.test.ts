import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCorpus } from "../corpus.ts";
import { RagError } from "../errors.ts";
import { writeCorpus } from "./support.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "devflow-lab-corpus-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const codeOf = (action: () => unknown) => {
  try {
    action();
  } catch (error) {
    return error instanceof RagError ? error.code : "OTHER";
  }
  return "NONE";
};
const ALL = ["**/*.md"];

describe("загрузка корпуса", () => {
  it("читает вложенные .md в стабильном порядке и игнорирует остальные файлы", () => {
    writeCorpus(root, { "b/two.md": "# Два", "a.md": "# Один", "notes.txt": "не документ", "b/one.md": "# Раз" });
    expect(loadCorpus(root, ALL).map((document) => document.file)).toEqual(["a.md", "b/one.md", "b/two.md"]);
  });

  it("убирает frontmatter из текста; source и title берёт из него", () => {
    writeCorpus(root, {
      "a.md": '---\nsource: "https://example.test/a.md"\ntitle: "Из метаданных"\n---\n\n# Заголовок\n\nТекст',
    });
    const [document] = loadCorpus(root, ALL);
    expect(document?.source).toBe("https://example.test/a.md");
    expect(document?.title).toBe("Из метаданных");
    expect(document?.content.text).toBe("# Заголовок\n\nТекст");
  });

  it("без метаданных источник — относительный путь, название — первый H1, затем имя файла", () => {
    writeCorpus(root, { "dir/a.md": "текст\n\n# Первый\n\nещё", "dir/plain.md": "только текст" });
    const documents = loadCorpus(root, ALL);
    expect(documents.map((document) => [document.source, document.title])).toEqual([
      ["dir/a.md", "Первый"],
      ["dir/plain.md", "plain"],
    ]);
  });

  it("нормализует BOM и переводы строк: хеш и текст не зависят от них", () => {
    writeCorpus(root, { "lf.md": "# T\n\nстрока", "crlf.md": "﻿# T\r\n\r\nстрока" });
    const [crlf, lf] = loadCorpus(root, ALL);
    expect(crlf?.content.text).toBe("# T\n\nстрока");
    expect(crlf?.hash).toBe(lf?.hash);
  });

  it("отклоняет frontmatter с ошибкой YAML и не-словарь", () => {
    writeCorpus(root, { "a.md": "---\ntitle: [\n---\n\n# T" });
    expect(codeOf(() => loadCorpus(root, ALL))).toBe("INVALID_FRONTMATTER");
    writeCorpus(root, { "a.md": "---\n- список\n---\n\n# T" });
    expect(codeOf(() => loadCorpus(root, ALL))).toBe("INVALID_FRONTMATTER");
  });

  it("берёт только файлы по шаблонам include, без повторов и служебных каталогов", () => {
    writeCorpus(root, {
      "README.md": "# Проект",
      "AGENTS.md": "# Правила",
      "docs/adr/0001.md": "# Решение",
      "src/notes.md": "# Не входит",
      "node_modules/pkg/README.md": "# Чужой пакет",
      ".local/rag/report.md": "# Отчёт",
    });
    const include = ["README.md", "AGENTS.md", "docs/**/*.md", "**/README.md", "**/report.md"];
    expect(loadCorpus(root, include).map((document) => [document.file, document.title])).toEqual([
      ["AGENTS.md", "Правила"],
      ["README.md", "Проект"],
      ["docs/adr/0001.md", "Решение"],
    ]);
  });

  it("пропускает символические ссылки на файлы", () => {
    writeCorpus(root, { "a.md": "# A" });
    symlinkSync(join(root, "a.md"), join(root, "link.md"));
    expect(loadCorpus(root, ALL).map((document) => document.file)).toEqual(["a.md"]);
  });

  it("отличает отсутствующий каталог от пустого корпуса", () => {
    expect(codeOf(() => loadCorpus(join(root, "missing"), ALL))).toBe("CORPUS_NOT_FOUND");
    writeFileSync(join(root, "file"), "x");
    expect(codeOf(() => loadCorpus(join(root, "file"), ALL))).toBe("CORPUS_NOT_FOUND");
    mkdirSync(join(root, "empty"));
    expect(codeOf(() => loadCorpus(join(root, "empty"), ALL))).toBe("EMPTY_CORPUS");
    writeCorpus(root, { "empty/blank.md": "---\ntitle: x\n---\n\n  \n" });
    expect(codeOf(() => loadCorpus(join(root, "empty"), ALL))).toBe("EMPTY_CORPUS");
  });
});
