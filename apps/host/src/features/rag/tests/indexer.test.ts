import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RagError } from "../errors.ts";
import { indexCorpus, type ProgressEvent } from "../indexer.ts";
import { readIndex } from "../indexFile.ts";
import { fakeEmbeddings, PARAMS, writeCorpus } from "./support.ts";

const CORPUS = {
  "a/one.md": `# Один\n\n${"первое ".repeat(40)}\n\n## Раздел\n\n${"второе ".repeat(30)}`,
  "b/two.md": "# Два\n\nкороткий документ",
};

let root: string;
let inputDir: string;
let outputFile: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "devflow-lab-index-"));
  inputDir = join(root, "corpus");
  outputFile = join(root, "out", "index.json");
  writeCorpus(inputDir, CORPUS);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const build = (embeddings = fakeEmbeddings(), params = PARAMS, onProgress?: (event: ProgressEvent) => void) =>
  indexCorpus({
    projectRoot: inputDir,
    include: ["**/*.md"],
    outputFile,
    params,
    embeddings,
    now: () => new Date("2026-09-29T10:00:00Z"),
    onProgress,
  });
const codeOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof RagError ? `${error.code}:${error.data.reason ?? ""}` : "OTHER";
  }
  return "NONE";
};

describe("индексация корпуса", () => {
  it("строит обе стратегии, прогревает модель и сохраняет проверяемый индекс с метаданными", async () => {
    const embeddings = fakeEmbeddings(3);
    const result = await build(embeddings);
    expect(embeddings.calls[0]).toHaveLength(1);
    const { index } = await readIndex(outputFile);
    expect(index).toMatchObject({
      formatVersion: 1,
      createdAt: "2026-09-29T10:00:00.000Z",
      params: PARAMS,
      model: { name: "fake:latest", digest: "0123456789abcdef", dimension: 3 },
      modelLoadMs: 5,
    });
    expect(index.documents.map((document) => document.file)).toEqual(["a/one.md", "b/two.md"]);
    expect(index.documents[0]?.blocks.length).toBeGreaterThan(0);
    for (const strategy of ["fixed", "structure"] as const) {
      const { chunks } = index.strategies[strategy];
      expect(chunks.length).toBeGreaterThan(1);
      expect(new Set(chunks.map((chunk) => chunk.chunk_id)).size).toBe(chunks.length);
      expect(chunks.every((chunk) => chunk.embedding.length === 3 && chunk.strategy === strategy)).toBe(true);
      expect(result.strategies[strategy].chunks).toBe(chunks.length);
      expect(result.strategies[strategy].promptTokens).toBe(index.strategies[strategy].promptTokens);
    }
    expect(result).toMatchObject({ path: outputFile, documents: 2, model: { dimension: 3 } });
  });

  it("сообщает о ходе по стратегиям в порядке выполнения", async () => {
    const events: ProgressEvent[] = [];
    await build(fakeEmbeddings(), PARAMS, (event) => events.push(event));
    expect(events.map((event) => `${event.strategy}:${event.stage}`)).toEqual([
      "fixed:chunked",
      "fixed:embedded",
      "structure:chunked",
      "structure:embedded",
    ]);
  });

  it("повторная сборка даёт те же ID и хеш корпуса, а смена параметров — новые ID", async () => {
    await build();
    const first = (await readIndex(outputFile)).index;
    await build();
    const again = (await readIndex(outputFile)).index;
    expect(again.corpusHash).toBe(first.corpusHash);
    expect(again.strategies.fixed.chunks.map((chunk) => chunk.chunk_id)).toEqual(
      first.strategies.fixed.chunks.map((chunk) => chunk.chunk_id),
    );
    await build(fakeEmbeddings(), { ...PARAMS, chunkSizeChars: 120 });
    const changed = (await readIndex(outputFile)).index;
    expect(changed.strategies.fixed.chunks[0]?.chunk_id).not.toBe(first.strategies.fixed.chunks[0]?.chunk_id);
  });

  it("при сбое эмбеддингов прежний индекс остаётся целым и временных файлов нет", async () => {
    await build();
    const before = readFileSync(outputFile, "utf8");
    const failing = fakeEmbeddings();
    failing.failOnCall = 3;
    await expect(build(failing)).rejects.toThrow("сбой эмбеддингов");
    expect(readFileSync(outputFile, "utf8")).toBe(before);
    expect(readdirSync(join(root, "out"))).toEqual(["index.json"]);
  });

  it("если каталог результата создать нельзя, сообщает об ошибке записи, а не системный текст", async () => {
    const blocker = join(root, "blocker");
    writeFileSync(blocker, "файл вместо каталога");
    const failing = indexCorpus({
      projectRoot: inputDir,
      include: ["**/*.md"],
      outputFile: join(blocker, "index.json"),
      params: PARAMS,
      embeddings: fakeEmbeddings(),
    });
    expect(await codeOf(failing)).toBe("INDEX_WRITE_FAILED:");
  });

  it("отклоняет несовместимые параметры до любых обращений к модели", async () => {
    const embeddings = fakeEmbeddings();
    expect(await codeOf(build(embeddings, { ...PARAMS, overlapChars: PARAMS.chunkSizeChars }))).toBe(
      "INVALID_CHUNK_PARAMS:overlap",
    );
    expect(await codeOf(build(embeddings, { ...PARAMS, minChunkChars: PARAMS.chunkSizeChars + 1 }))).toBe(
      "INVALID_CHUNK_PARAMS:min",
    );
    expect(embeddings.calls).toHaveLength(0);
    expect(readdirSync(root)).toEqual(["corpus"]);
  });

  it("ошибка корпуса или отсутствующая модель не доходят до эмбеддингов и не создают индекс", async () => {
    const embeddings = fakeEmbeddings();
    rmSync(inputDir, { recursive: true });
    expect(await codeOf(build(embeddings))).toBe("CORPUS_NOT_FOUND:");
    writeCorpus(inputDir, CORPUS);
    vi.spyOn(embeddings, "describeModel").mockRejectedValue(new RagError("MODEL_NOT_FOUND", { model: "x" }));
    expect(await codeOf(build(embeddings))).toBe("MODEL_NOT_FOUND:");
    expect(embeddings.calls).toHaveLength(0);
    expect(readdirSync(root)).toEqual(["corpus"]);
  });
});
