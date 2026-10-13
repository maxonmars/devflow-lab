import { type EmbeddingPort, embedAll } from "./embeddings.ts";
import { RagError } from "./errors.ts";
import { readIndex } from "./indexFile.ts";
import type { Chunk, EmbeddedChunk, Strategy } from "./types.ts";

/** Найденный чанк без эмбеддинга; `rank` считается с 1. */
export type SearchHit = Readonly<{ rank: number; score: number; chunk: Chunk }>;

export type SearchIndex = Readonly<{
  createdAt: string;
  model: Readonly<{ name: string; digest: string; dimension: number }>;
  files: readonly string[];
  search(question: string, strategy: Strategy, topK: number): Promise<readonly SearchHit[]>;
}>;

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [position, x] of a.entries()) {
    const y = b[position] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}

/** Линейный перебор; при равном сходстве сохраняется порядок чанков в индексе. */
export function rankChunks(chunks: readonly EmbeddedChunk[], query: readonly number[], topK: number): SearchHit[] {
  return chunks
    .map((item, order) => {
      const { embedding, ...chunk } = item;
      return { order, score: cosine(embedding, query), chunk };
    })
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .slice(0, topK)
    .map(({ score, chunk }, position) => ({ rank: position + 1, score, chunk }));
}

export type OpenIndexOptions = Readonly<{ indexFile: string; embeddings: EmbeddingPort }>;

/** Читает индекс один раз и проверяет, что модель эмбеддингов та же, что при построении. */
export async function openIndex(options: OpenIndexOptions): Promise<SearchIndex> {
  const { index } = await readIndex(options.indexFile);
  const info = await options.embeddings.describeModel();
  if (info.digest !== index.model.digest) {
    throw new RagError("INDEX_MODEL_MISMATCH", { indexModel: index.model.name, model: info.name });
  }
  return {
    createdAt: index.createdAt,
    model: index.model,
    files: index.documents.map((document) => document.file),
    async search(question, strategy, topK) {
      const { vectors } = await embedAll(options.embeddings, [question], index.model.dimension);
      const [vector = []] = vectors;
      return rankChunks(index.strategies[strategy].chunks, vector, topK);
    },
  };
}
