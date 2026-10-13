import { RagError } from "./errors.ts";

/** Пакет эмбеддингов одного запроса: `promptTokens` и `loadDurationMs` сообщает провайдер на весь пакет. */
export type EmbedBatch = Readonly<{
  vectors: readonly (readonly number[])[];
  promptTokens: number;
  loadDurationMs: number;
}>;

export type ModelInfo = Readonly<{ name: string; digest: string }>;

/** Локальный порт модели эмбеддингов; ответ провайдера проверяет `embedAll`, а не реализация. */
export interface EmbeddingPort {
  embed(texts: readonly string[]): Promise<EmbedBatch>;
  describeModel(): Promise<ModelInfo>;
}

export const EMBED_BATCH_SIZE = 8;

export type Embedded = Readonly<{
  vectors: readonly (readonly number[])[];
  dimension: number;
  promptTokens: number;
  loadDurationMs: number;
  elapsedMs: number;
}>;

function checkBatch(batch: EmbedBatch, count: number, expectedDimension: number | undefined): number {
  if (batch.vectors.length !== count) throw new RagError("INVALID_EMBEDDINGS", { reason: "count" });
  const dimension = expectedDimension ?? batch.vectors[0]?.length ?? 0;
  for (const vector of batch.vectors) {
    if (vector.length === 0) throw new RagError("INVALID_EMBEDDINGS", { reason: "empty" });
    if (vector.length !== dimension) throw new RagError("INVALID_EMBEDDINGS", { reason: "dimension" });
    if (!vector.every(Number.isFinite)) throw new RagError("INVALID_EMBEDDINGS", { reason: "value" });
  }
  return dimension;
}

/** Последовательные пакеты по `EMBED_BATCH_SIZE`; без повторов, автоматических обрезок и параллелизма. */
export async function embedAll(
  port: EmbeddingPort,
  texts: readonly string[],
  expectedDimension?: number,
): Promise<Embedded> {
  const started = performance.now();
  const vectors: (readonly number[])[] = [];
  let dimension = expectedDimension;
  let promptTokens = 0;
  let loadDurationMs = 0;
  for (let offset = 0; offset < texts.length; offset += EMBED_BATCH_SIZE) {
    const batchTexts = texts.slice(offset, offset + EMBED_BATCH_SIZE);
    const batch = await port.embed(batchTexts);
    dimension = checkBatch(batch, batchTexts.length, dimension);
    vectors.push(...batch.vectors);
    promptTokens += batch.promptTokens;
    loadDurationMs += batch.loadDurationMs;
  }
  return { vectors, dimension: dimension ?? 0, promptTokens, loadDurationMs, elapsedMs: performance.now() - started };
}
