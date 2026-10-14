import { checkRetrievalParams, type RetrievalParams } from "./retrieval.ts";
import type { SearchHit, SearchIndex } from "./search.ts";

export type SearchQueriesOptions = RetrievalParams & Readonly<{ index: SearchIndex; queries: readonly string[] }>;

/** Поиск по каждому запросу, порог, объединение по `chunk_id` с максимальным score, затем `topK` с рангами от 1. */
export async function searchQueries(options: SearchQueriesOptions): Promise<SearchHit[]> {
  checkRetrievalParams(options);
  const best = new Map<string, Readonly<{ order: number; hit: SearchHit }>>();
  for (const query of options.queries) {
    if (!query.trim()) continue;
    // По очереди: каждый запрос — отдельный вызов эмбеддингов Ollama.
    for (const hit of await options.index.search(query, options.candidateTopK)) {
      if (hit.score < options.threshold) continue;
      const seen = best.get(hit.chunk.chunk_id);
      if (!seen) best.set(hit.chunk.chunk_id, { order: best.size, hit });
      else if (hit.score > seen.hit.score) best.set(hit.chunk.chunk_id, { order: seen.order, hit });
    }
  }
  return [...best.values()]
    .sort((left, right) => right.hit.score - left.hit.score || left.order - right.order)
    .slice(0, options.topK)
    .map(({ hit }, position) => ({ ...hit, rank: position + 1 }));
}
