export const STRATEGIES = ["fixed", "structure"] as const;
export type Strategy = (typeof STRATEGIES)[number];

export const BLOCK_TYPES = ["heading", "paragraph", "code", "table", "list", "blockquote", "html", "other"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export type ChunkParams = Readonly<{ chunkSizeChars: number; overlapChars: number; minChunkChars: number }>;

/** Блок верхнего уровня Markdown; `start`/`end` — кодовые точки нормализованного текста, `section` — путь заголовков. */
export type Block = Readonly<{ type: BlockType; start: number; end: number; section: string }>;

export type Range = Readonly<{ start: number; end: number }>;

export type Chunk = Readonly<{
  chunk_id: string;
  strategy: Strategy;
  source: string;
  title: string;
  file: string;
  sections: readonly string[];
  start: number;
  end: number;
  text: string;
}>;

export type EmbeddedChunk = Chunk & Readonly<{ embedding: readonly number[] }>;
