import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RagError } from "../errors.ts";
import { indexCorpus } from "../indexer.ts";
import { cosine, openIndex, rankChunks } from "../search.ts";
import type { EmbeddedChunk } from "../types.ts";
import { fakeEmbeddings, keywordEmbeddings, PARAMS, writeCorpus } from "./support.ts";

const chunkOf = (id: string, embedding: number[]): EmbeddedChunk => ({
  chunk_id: id,
  source: "src",
  title: "Doc",
  file: "doc.md",
  sections: ["Doc"],
  start: 0,
  end: 1,
  text: id,
  embedding,
});

describe("cosine", () => {
  it("равен 1 для одинаковых направлений, 0 для ортогональных и 0 для нулевого вектора", () => {
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(cosine([1, 1], [0, 0])).toBe(0);
  });
});

describe("rankChunks", () => {
  const chunks = [chunkOf("a", [0, 1]), chunkOf("b", [1, 0]), chunkOf("c", [1, 1])];

  it("сортирует по убыванию сходства и нумерует ранги с 1", () => {
    const hits = rankChunks(chunks, [1, 0], 3);
    expect(hits.map((hit) => [hit.rank, hit.chunk.chunk_id])).toEqual([
      [1, "b"],
      [2, "c"],
      [3, "a"],
    ]);
    expect(hits[0]?.score).toBeCloseTo(1);
  });

  it("при равном сходстве сохраняет порядок чанков в индексе", () => {
    const equal = [chunkOf("x", [1, 0]), chunkOf("y", [2, 0]), chunkOf("z", [3, 0])];
    expect(rankChunks(equal, [1, 0], 3).map((hit) => hit.chunk.chunk_id)).toEqual(["x", "y", "z"]);
  });

  it("возвращает не больше topK, а при topK больше числа чанков — все чанки", () => {
    expect(rankChunks(chunks, [1, 0], 1)).toHaveLength(1);
    expect(rankChunks(chunks, [1, 0], 10)).toHaveLength(3);
  });

  it("не копирует эмбеддинг в результат", () => {
    for (const hit of rankChunks(chunks, [1, 0], 3)) expect(hit.chunk).not.toHaveProperty("embedding");
  });
});

describe("openIndex", () => {
  let root: string;
  let indexFile: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "devflow-lab-search-"));
    indexFile = join(root, "index.json");
    writeCorpus(join(root, "corpus"), {
      "cats.md": `# Кошки\n\n${"кошка мяукает громко. ".repeat(8)}`,
      "dogs.md": `# Собаки\n\n${"собака лает громко. ".repeat(8)}`,
    });
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const build = (embeddings = keywordEmbeddings(["кошка", "собака"])) =>
    indexCorpus({
      projectRoot: join(root, "corpus"),
      include: ["**/*.md"],
      outputFile: indexFile,
      params: PARAMS,
      embeddings,
    });
  const codeOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return error instanceof RagError ? error.code : "OTHER";
    }
    return "NONE";
  };

  it("без файла индекса сообщает INDEX_NOT_FOUND", async () => {
    const code = await codeOf(openIndex({ indexFile, embeddings: fakeEmbeddings() }));
    expect(code).toBe("INDEX_NOT_FOUND");
  });

  it("при другой модели эмбеддингов (другой digest) сообщает INDEX_MODEL_MISMATCH", async () => {
    await build();
    const other = fakeEmbeddings();
    other.describeModel = async () => ({ name: "other:latest", digest: "ffff" });
    const error = await openIndex({ indexFile, embeddings: other }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RagError);
    expect((error as RagError).code).toBe("INDEX_MODEL_MISMATCH");
    expect((error as RagError).data).toEqual({ indexModel: "fake:latest", model: "other:latest" });
  });

  it("эмбеддит один текст — вопрос — и ранжирует чанки по сходству", async () => {
    await build();
    const embeddings = keywordEmbeddings(["кошка", "собака"]);
    const index = await openIndex({ indexFile, embeddings });
    embeddings.calls.length = 0;
    const hits = await index.search("Что делает кошка?", 2);
    expect(embeddings.calls).toEqual([["Что делает кошка?"]]);
    expect(hits).toHaveLength(2);
    expect(hits[0]?.chunk.file).toBe("cats.md");
    const dogs = await index.search("Что делает собака?", 1);
    expect(dogs[0]?.chunk.file).toBe("dogs.md");
  });

  it("раскрывает время создания, модель и файлы индекса", async () => {
    await build();
    const index = await openIndex({ indexFile, embeddings: keywordEmbeddings(["кошка", "собака"]) });
    expect(index.files).toEqual(["cats.md", "dogs.md"]);
    expect(index.model).toEqual({ name: "fake:latest", digest: "0123456789abcdef", dimension: 2 });
    expect(Number.isNaN(Date.parse(index.createdAt))).toBe(false);
  });
});
