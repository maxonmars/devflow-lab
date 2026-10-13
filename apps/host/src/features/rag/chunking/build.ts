import type { LoadedDocument } from "../corpus.ts";
import { sha256 } from "../text.ts";
import type { Chunk, ChunkParams, Range } from "../types.ts";
import { structureRanges } from "./structure.ts";

const ID_HASH_LENGTH = 8;

const paramsKey = (params: ChunkParams): string =>
  `size=${params.chunkSizeChars};overlap=${params.overlapChars};min=${params.minChunkChars}`;

/** Уникальные пути заголовков блоков, пересекающих диапазон, в порядке документа. */
function sectionsIn(document: LoadedDocument, range: Range): string[] {
  const paths = document.blocks
    .filter((block) => block.start < range.end && block.end > range.start)
    .map((block) => block.section || document.title);
  return [...new Set(paths)];
}

/** `chunk_id` = файл, порядковый номер и хеш документа, параметров и диапазона. */
export function chunkId(document: LoadedDocument, params: ChunkParams, ordinal: number, range: Range) {
  const hash = sha256(`${document.hash}\n${paramsKey(params)}\n${range.start}-${range.end}`);
  return `${document.file}#${String(ordinal).padStart(3, "0")}-${hash.slice(0, ID_HASH_LENGTH)}`;
}

/** Чанки по заголовкам и целым блокам Markdown; слишком длинный блок режется окнами `fixed`. */
export function buildChunks(document: LoadedDocument, params: ChunkParams): Chunk[] {
  const chunks: Chunk[] = [];
  for (const range of structureRanges(document.blocks, params)) {
    const text = document.content.slice(range.start, range.end);
    if (!text.trim()) continue;
    chunks.push({
      chunk_id: chunkId(document, params, chunks.length, range),
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
