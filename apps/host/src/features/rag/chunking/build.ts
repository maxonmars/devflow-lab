import type { LoadedDocument } from "../corpus.ts";
import { sha256 } from "../text.ts";
import type { Chunk, ChunkParams, Range, Strategy } from "../types.ts";
import { fixedRanges } from "./fixed.ts";
import { structureRanges } from "./structure.ts";

const ID_HASH_LENGTH = 8;

function paramsKey(strategy: Strategy, params: ChunkParams): string {
  const base = `size=${params.chunkSizeChars};overlap=${params.overlapChars}`;
  return strategy === "fixed" ? base : `${base};min=${params.minChunkChars}`;
}

/** Уникальные пути заголовков блоков, пересекающих диапазон, в порядке документа. */
function sectionsIn(document: LoadedDocument, range: Range): string[] {
  const paths = document.blocks
    .filter((block) => block.start < range.end && block.end > range.start)
    .map((block) => block.section || document.title);
  return [...new Set(paths)];
}

/** `chunk_id` = стратегия, файл, порядковый номер и хеш документа, параметров и диапазона. */
export function chunkId(
  document: LoadedDocument,
  strategy: Strategy,
  params: ChunkParams,
  ordinal: number,
  range: Range,
) {
  const hash = sha256(`${document.hash}\n${strategy}\n${paramsKey(strategy, params)}\n${range.start}-${range.end}`);
  return `${strategy}:${document.file}#${String(ordinal).padStart(3, "0")}-${hash.slice(0, ID_HASH_LENGTH)}`;
}

export function buildChunks(document: LoadedDocument, strategy: Strategy, params: ChunkParams): Chunk[] {
  const ranges =
    strategy === "fixed"
      ? fixedRanges(0, document.content.length, params.chunkSizeChars, params.overlapChars)
      : structureRanges(document.blocks, params);
  const chunks: Chunk[] = [];
  for (const range of ranges) {
    const text = document.content.slice(range.start, range.end);
    if (!text.trim()) continue;
    chunks.push({
      chunk_id: chunkId(document, strategy, params, chunks.length, range),
      strategy,
      source: document.source,
      title: document.title,
      file: document.file,
      sections: sectionsIn(document, range),
      start: range.start,
      end: range.end,
      text,
    });
  }
  return chunks;
}
