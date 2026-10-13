import { readFile } from "node:fs/promises";
import { z } from "zod";
import { writeFileAtomic } from "./atomicWrite.ts";
import { RagError } from "./errors.ts";
import { BLOCK_TYPES, STRATEGIES } from "./types.ts";

const count = z.number().int().nonnegative();

const chunkSchema = z.object({
  chunk_id: z.string(),
  strategy: z.enum(STRATEGIES),
  source: z.string(),
  title: z.string(),
  file: z.string(),
  sections: z.array(z.string()),
  start: count,
  end: count,
  text: z.string(),
  embedding: z.array(z.number()),
});

const strategySchema = z.object({
  chunkingMs: z.number(),
  embeddingMs: z.number(),
  promptTokens: count,
  chunks: z.array(chunkSchema),
});

const documentSchema = z.object({
  file: z.string(),
  source: z.string(),
  title: z.string(),
  hash: z.string(),
  text: z.string(),
  blocks: z.array(z.object({ type: z.enum(BLOCK_TYPES), start: count, end: count, section: z.string() })),
});

export const INDEX_FORMAT_VERSION = 1;

const indexSchema = z.object({
  formatVersion: z.literal(INDEX_FORMAT_VERSION),
  createdAt: z.string(),
  corpusHash: z.string(),
  params: z.object({ chunkSizeChars: count, overlapChars: count, minChunkChars: count }),
  model: z.object({ name: z.string(), digest: z.string(), dimension: z.number().int().positive() }),
  modelLoadMs: z.number(),
  documents: z.array(documentSchema),
  strategies: z.object({ fixed: strategySchema, structure: strategySchema }),
});

export type IndexFile = z.infer<typeof indexSchema>;
export type StrategyIndex = z.infer<typeof strategySchema>;

export async function writeIndex(path: string, index: IndexFile): Promise<void> {
  await writeFileAtomic(path, JSON.stringify(index));
}

export async function readIndex(path: string): Promise<{ index: IndexFile; bytes: number }> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new RagError("INDEX_NOT_FOUND");
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new RagError("INDEX_INVALID");
  }
  const parsed = indexSchema.safeParse(data);
  if (!parsed.success) throw new RagError("INDEX_INVALID");
  return { index: parsed.data, bytes: Buffer.byteLength(raw) };
}
