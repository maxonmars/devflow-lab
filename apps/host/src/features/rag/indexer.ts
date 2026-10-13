import { buildChunks } from "./chunking/build.ts";
import { type LoadedDocument, loadCorpus } from "./corpus.ts";
import { type EmbeddingPort, embedAll } from "./embeddings.ts";
import { RagError } from "./errors.ts";
import { INDEX_FORMAT_VERSION, type IndexFile, writeIndex } from "./indexFile.ts";
import { sha256 } from "./text.ts";
import type { ChunkParams } from "./types.ts";

const WARMUP_TEXT = "Прогрев модели эмбеддингов.";

export type ProgressEvent = Readonly<{ stage: "chunked" | "embedded"; chunks: number }>;

export type IndexOptions = Readonly<{
  projectRoot: string;
  include: readonly string[];
  outputFile: string;
  params: ChunkParams;
  embeddings: EmbeddingPort;
  now?: () => Date;
  onProgress?: (event: ProgressEvent) => void;
}>;

export type IndexStats = Readonly<{
  chunks: number;
  promptTokens: number;
  chunkingMs: number;
  embeddingMs: number;
}>;

export type IndexResult = Readonly<{
  path: string;
  documents: number;
  chars: number;
  model: IndexFile["model"];
  modelLoadMs: number;
  stats: IndexStats;
}>;

export function validateParams(params: ChunkParams): void {
  if (params.overlapChars >= params.chunkSizeChars) throw new RagError("INVALID_CHUNK_PARAMS", { reason: "overlap" });
  if (params.minChunkChars > params.chunkSizeChars) throw new RagError("INVALID_CHUNK_PARAMS", { reason: "min" });
}

async function embedChunks(documents: readonly LoadedDocument[], options: IndexOptions, dimension: number) {
  const chunkingStarted = performance.now();
  const chunks = documents.flatMap((document) => buildChunks(document, options.params));
  const chunkingMs = performance.now() - chunkingStarted;
  options.onProgress?.({ stage: "chunked", chunks: chunks.length });
  const embedded = await embedAll(
    options.embeddings,
    chunks.map((chunk) => chunk.text),
    dimension,
  );
  options.onProgress?.({ stage: "embedded", chunks: chunks.length });
  return {
    stats: { chunks: chunks.length, chunkingMs, embeddingMs: embedded.elapsedMs, promptTokens: embedded.promptTokens },
    chunks: chunks.map((chunk, index) => ({
      ...chunk,
      sections: [...chunk.sections],
      embedding: [...(embedded.vectors[index] ?? [])],
    })),
  };
}

/** Заменяет `index.json` целиком только после успешных эмбеддингов всех чанков. */
export async function indexCorpus(options: IndexOptions): Promise<IndexResult> {
  validateParams(options.params);
  const documents = loadCorpus(options.projectRoot, options.include);
  const model = await options.embeddings.describeModel();
  const warmup = await embedAll(options.embeddings, [WARMUP_TEXT]);
  const { stats, chunks } = await embedChunks(documents, options, warmup.dimension);
  const index: IndexFile = {
    formatVersion: INDEX_FORMAT_VERSION,
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
    corpusHash: sha256(documents.map((document) => `${document.file}\0${document.hash}`).join("\n")),
    params: { ...options.params },
    model: { ...model, dimension: warmup.dimension },
    modelLoadMs: warmup.loadDurationMs,
    documents: documents.map((document) => ({
      file: document.file,
      source: document.source,
      title: document.title,
      hash: document.hash,
      text: document.content.text,
      blocks: [...document.blocks],
    })),
    stats: { chunkingMs: stats.chunkingMs, embeddingMs: stats.embeddingMs, promptTokens: stats.promptTokens },
    chunks,
  };
  await writeIndex(options.outputFile, index);
  return {
    path: options.outputFile,
    documents: documents.length,
    chars: documents.reduce((sum, document) => sum + document.content.length, 0),
    model: index.model,
    modelLoadMs: index.modelLoadMs,
    stats,
  };
}
