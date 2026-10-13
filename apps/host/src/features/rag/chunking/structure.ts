import type { Block, ChunkParams, Range } from "../types.ts";
import { fixedRanges } from "./fixed.ts";

const rangeOf = (blocks: readonly Block[]): Range => ({
  start: blocks[0]?.start ?? 0,
  end: blocks.at(-1)?.end ?? 0,
});

const size = (range: Range): number => range.end - range.start;

/** Целые блоки с конца чанка суммарной длиной не больше `overlap`; чанк целиком не возвращается. */
function trailingBlocks(blocks: readonly Block[], overlap: number): Block[] {
  const end = blocks.at(-1)?.end ?? 0;
  const tail: Block[] = [];
  for (const block of blocks.slice(1).reverse()) {
    if (end - block.start > overlap) break;
    tail.unshift(block);
  }
  return tail;
}

/**
 * Чанки по структуре за один проход по блокам: чанк закрывается перед заголовком (если не короче `min`) или когда
 * блок не помещается в `max`; блок длиннее `max` делится окнами; чанк короче `min` присоединяется к предыдущему.
 */
export function structureRanges(blocks: readonly Block[], params: ChunkParams): Range[] {
  const { chunkSizeChars: max, overlapChars: overlap, minChunkChars: min } = params;
  const ranges: Range[] = [];
  const push = (piece: Range) => {
    const last = ranges.at(-1);
    if (last && size(piece) < min && piece.end - last.start <= max)
      ranges[ranges.length - 1] = { ...last, end: piece.end };
    else ranges.push(piece);
  };
  let current: Block[] = [];
  for (const block of blocks) {
    if (size(block) > max) {
      const lead = current.length > 0 && size(rangeOf(current)) < min;
      if (current.length > 0 && !lead) push(rangeOf(current));
      for (const piece of fixedRanges(lead ? (current[0]?.start ?? block.start) : block.start, block.end, max, overlap))
        push(piece);
      current = [];
      continue;
    }
    const startsSection = block.type === "heading";
    const overflow = current.length > 0 && block.end - (current[0]?.start ?? 0) > max;
    const boundary = startsSection && current.length > 0 && size(rangeOf(current)) >= min;
    if (overflow || boundary) {
      const carry =
        overflow && !startsSection && current.length > 1 && current.at(-1)?.type === "heading"
          ? current.splice(-1)
          : [];
      push(rangeOf(current));
      current = carry.length > 0 || startsSection ? carry : trailingBlocks(current, overlap);
      while (current.length > 0 && block.end - (current[0]?.start ?? 0) > max) current.shift();
    }
    current.push(block);
  }
  if (current.length > 0) push(rangeOf(current));
  return ranges;
}
