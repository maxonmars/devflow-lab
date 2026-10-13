import { RagError } from "./errors.ts";

export const RETRIEVAL_MODES = ["baseline", "filter", "rewrite", "rewrite-filter"] as const;
export type RetrievalMode = (typeof RETRIEVAL_MODES)[number];

export const MAX_TOP_K = 20;
export const SIMILARITY_RANGE = { min: -1, max: 1 } as const;

/** `candidateTopK` — сколько кандидатов вернёт поиск; `topK` — сколько из них получит модель. */
export type RetrievalParams = Readonly<{ candidateTopK: number; topK: number; threshold: number }>;

const STAGES: Readonly<Record<RetrievalMode, Readonly<{ rewrite: boolean; filter: boolean }>>> = {
  baseline: { rewrite: false, filter: false },
  filter: { rewrite: false, filter: true },
  rewrite: { rewrite: true, filter: false },
  "rewrite-filter": { rewrite: true, filter: true },
};

export const usesRewrite = (mode: RetrievalMode): boolean => STAGES[mode].rewrite;
export const usesFilter = (mode: RetrievalMode): boolean => STAGES[mode].filter;

const isLimit = (value: number): boolean => Number.isInteger(value) && value >= 1 && value <= MAX_TOP_K;

/** Единственная проверка согласованности параметров: вызывается до любых внешних обращений. */
export function checkRetrievalParams(params: RetrievalParams): void {
  const { candidateTopK, topK, threshold } = params;
  if (!isLimit(candidateTopK)) throw new RagError("INVALID_RETRIEVAL_PARAMS", { reason: "candidateTopK" });
  if (!isLimit(topK)) throw new RagError("INVALID_RETRIEVAL_PARAMS", { reason: "topK" });
  if (topK > candidateTopK) throw new RagError("INVALID_RETRIEVAL_PARAMS", { reason: "order" });
  if (!Number.isFinite(threshold) || threshold < SIMILARITY_RANGE.min || threshold > SIMILARITY_RANGE.max) {
    throw new RagError("INVALID_RETRIEVAL_PARAMS", { reason: "threshold" });
  }
}
