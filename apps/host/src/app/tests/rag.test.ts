import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RagError } from "../../features/rag/index.ts";
import { fakeEmbeddings, invoke, writeCorpus } from "./harness.ts";

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "devflow-lab-app-"));
  writeCorpus(join(cwd, "docs"), {
    "a.md": `# Один\n\n${"слово ".repeat(500)}\n\n## Раздел\n\nтекст раздела`,
    "b.md": "# Два\n\nкороткий документ",
  });
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("команды rag", () => {
  it("rag index строит индекс из настроек по умолчанию и печатает итог с ходом операции", async () => {
    const embeddings = fakeEmbeddings();
    const result = await invoke(["rag", "index"], { cwd, embeddings, authenticated: false });
    const indexFile = join(cwd, ".local/rag/index.json");
    expect(result.code).toBe(0);
    expect(existsSync(indexFile)).toBe(true);
    expect(result.output).toContain("── Индекс ──");
    expect(result.output).toContain("Документов: 2");
    expect(result.output).toContain("Модель: fake:latest");
    expect(result.output).toContain(`Сохранено: ${indexFile}`);
    expect(result.error).toContain("fixed: разбиение");
    expect(result.error).toContain("structure: эмбеддинги");
    expect(result.createModel).not.toHaveBeenCalled();
  });

  it("корпус берётся из project.root по rag.include: файлы вне шаблонов не индексируются", async () => {
    writeCorpus(join(cwd, "other"), { "README.md": "# Соседний проект\n\nтекст" });
    writeCorpus(cwd, { "notes/draft.md": "# Черновик\n\nвне шаблонов" });
    const own = await invoke(["rag", "index"], { cwd, embeddings: fakeEmbeddings() });
    expect(own.output).toContain("Документов: 2");
    const other = await invoke(["--project-root", "other", "rag", "index"], { cwd, embeddings: fakeEmbeddings() });
    expect(other.output).toContain("Документов: 1");
    const missing = await invoke(["--project-root", "missing", "rag", "index"], { cwd, embeddings: fakeEmbeddings() });
    expect(missing.error).toContain("project.root не найден");
  });

  it("одинаково работают через REPL", async () => {
    const cli = await invoke(["rag", "index"], { cwd, embeddings: fakeEmbeddings() });
    const repl = await invoke([], { cwd, input: "/rag index\n/exit\n", embeddings: fakeEmbeddings() });
    expect(stripDigits(repl.output)).toBe(stripDigits(cli.output));
  });

  it("настройки CLI меняют параметры чанкинга и каталоги", async () => {
    const result = await invoke(
      [
        "--rag-chunk-size-chars=300",
        "--rag-overlap-chars=0",
        "--rag-min-chunk-chars=100",
        "--rag-output-dir=out",
        "rag",
        "index",
      ],
      { cwd, embeddings: fakeEmbeddings() },
    );
    expect(result.code).toBe(0);
    expect(existsSync(join(cwd, "out/index.json"))).toBe(true);
  });

  it("несовместимые настройки и ошибки Ollama показываются по-русски, REPL продолжает работу", async () => {
    const overlap = await invoke(["--rag-overlap-chars", "1800", "rag", "index"], {
      cwd,
      embeddings: fakeEmbeddings(),
    });
    expect(overlap.error).toBe("Ошибка · rag.overlapChars должен быть меньше rag.chunkSizeChars.\n");
    const embeddings = fakeEmbeddings();
    embeddings.describeModel = async () => {
      throw new RagError("MODEL_NOT_FOUND", { model: "bge-m3" });
    };
    const repl = await invoke([], { cwd, input: "/rag index\n/config show\n/exit\n", embeddings });
    expect(repl.code).toBe(1);
    expect(repl.error).toContain("ollama pull bge-m3");
    expect(repl.output).toContain("rag.embeddingModel");
  });
});

const stripDigits = (text: string) => text.replaceAll(/\d+(\.\d+)?/g, "N");
