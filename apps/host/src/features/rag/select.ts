import { type RetrievalMode, type RetrievalParams, usesFilter } from "./retrieval.ts";
import type { SearchHit } from "./search.ts";

/** Разбиение кандидатов: `hits` уходят модели, остальные — с причиной исключения. */
export type Selection = Readonly<{
  hits: readonly SearchHit[];
  belowThreshold: readonly SearchHit[];
  overLimit: readonly SearchHit[];
}>;

export type SelectionRule = Readonly<{ filter: boolean; threshold: number; topK: number }>;

/** Порог, затем конечный top-K над упорядоченными кандидатами; порядок и score не меняются, чанки ниже порога не добираются. */
export function selectHits(candidates: readonly SearchHit[], rule: SelectionRule): Selection {
  const passes = (hit: SearchHit): boolean => !rule.filter || hit.score >= rule.threshold;
  const kept = candidates.filter(passes);
  return {
    hits: kept.slice(0, rule.topK),
    belowThreshold: candidates.filter((hit) => !passes(hit)),
    overLimit: kept.slice(rule.topK),
  };
}

export function selectForMode(
  mode: RetrievalMode,
  candidates: readonly SearchHit[],
  params: RetrievalParams,
): Selection {
  return selectHits(candidates, { filter: usesFilter(mode), threshold: params.threshold, topK: params.topK });
}
