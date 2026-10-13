import { describe, expect, it } from "vitest";
import { RagError } from "../errors.ts";
import { checkRetrievalParams, RETRIEVAL_MODES, type RetrievalParams, usesFilter, usesRewrite } from "../retrieval.ts";

const VALID: RetrievalParams = { candidateTopK: 10, topK: 5, threshold: 0.55 };

const reasonOf = (params: RetrievalParams): string | undefined => {
  try {
    checkRetrievalParams(params);
  } catch (error) {
    if (error instanceof RagError && error.code === "INVALID_RETRIEVAL_PARAMS") return String(error.data.reason);
    throw error;
  }
  return undefined;
};

describe("checkRetrievalParams", () => {
  it("принимает границы диапазонов и topK равный candidateTopK", () => {
    expect(reasonOf({ candidateTopK: 1, topK: 1, threshold: -1 })).toBeUndefined();
    expect(reasonOf({ candidateTopK: 20, topK: 20, threshold: 1 })).toBeUndefined();
    expect(reasonOf(VALID)).toBeUndefined();
  });

  it.each([0, 21, 2.5, Number.NaN])("candidateTopK %s отклоняется", (candidateTopK) => {
    expect(reasonOf({ ...VALID, candidateTopK })).toBe("candidateTopK");
  });

  it.each([0, 21, 1.5, Number.POSITIVE_INFINITY])("topK %s отклоняется", (topK) => {
    expect(reasonOf({ ...VALID, topK })).toBe("topK");
  });

  it("topK больше candidateTopK отклоняется как несогласованный порядок", () => {
    expect(reasonOf({ ...VALID, candidateTopK: 3, topK: 4 })).toBe("order");
  });

  it.each([-1.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY])("порог %s отклоняется", (threshold) => {
    expect(reasonOf({ ...VALID, threshold })).toBe("threshold");
  });
});

describe("режимы", () => {
  it("набор режимов один и в фиксированном порядке", () => {
    expect(RETRIEVAL_MODES).toEqual(["baseline", "filter", "rewrite", "rewrite-filter"]);
  });

  it("rewrite и фильтр включаются независимо друг от друга", () => {
    expect(RETRIEVAL_MODES.map((mode) => [usesRewrite(mode), usesFilter(mode)])).toEqual([
      [false, false],
      [false, true],
      [true, false],
      [true, true],
    ]);
  });
});
