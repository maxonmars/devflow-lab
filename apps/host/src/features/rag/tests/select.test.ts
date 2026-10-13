import { describe, expect, it } from "vitest";
import { selectForMode, selectHits } from "../select.ts";
import { searchHit } from "./support.ts";

const files = (hits: readonly { chunk: { file: string } }[]) => hits.map((hit) => hit.chunk.file);

describe("selectHits с порогом", () => {
  const candidates = [searchHit(1, "a.md", 0.8), searchHit(2, "b.md", 0.55), searchHit(3, "c.md", 0.5499)];

  it("сохраняет score ровно на пороге и удаляет score ниже порога", () => {
    const selection = selectHits(candidates, { filter: true, threshold: 0.55, topK: 5 });
    expect(files(selection.hits)).toEqual(["a.md", "b.md"]);
    expect(files(selection.belowThreshold)).toEqual(["c.md"]);
    expect(selection.overLimit).toEqual([]);
  });

  it("обрабатывает отрицательные scores и отрицательный порог", () => {
    const negative = [searchHit(1, "a.md", 0.1), searchHit(2, "b.md", -0.1), searchHit(3, "c.md", -0.3)];
    const selection = selectHits(negative, { filter: true, threshold: -0.2, topK: 5 });
    expect(files(selection.hits)).toEqual(["a.md", "b.md"]);
    expect(files(selection.belowThreshold)).toEqual(["c.md"]);
    expect(selectHits(negative, { filter: true, threshold: -1, topK: 5 }).hits).toHaveLength(3);
  });

  it("применяет конечный top-K после порога и считает отброшенных им отдельно", () => {
    const selection = selectHits(candidates, { filter: true, threshold: 0.55, topK: 1 });
    expect(files(selection.hits)).toEqual(["a.md"]);
    expect(files(selection.overLimit)).toEqual(["b.md"]);
    expect(files(selection.belowThreshold)).toEqual(["c.md"]);
  });

  it("не добирает чанки ниже порога, когда прошедших меньше K", () => {
    const selection = selectHits(candidates, { filter: true, threshold: 0.9, topK: 3 });
    expect(selection.hits).toEqual([]);
    expect(selection.belowThreshold).toHaveLength(3);
  });

  it("не меняет порядок, score и входной список", () => {
    const input = Object.freeze([...candidates]);
    const selection = selectHits(input, { filter: true, threshold: 0.5, topK: 2 });
    expect(selection.hits).toEqual([candidates[0], candidates[1]]);
    expect(selection.hits[0]).toBe(candidates[0]);
    expect(input).toEqual(candidates);
  });

  it("не убирает несколько чанков одного файла", () => {
    const same = [searchHit(1, "a.md", 0.9), searchHit(2, "a.md", 0.8)];
    expect(selectHits(same, { filter: true, threshold: 0.5, topK: 5 }).hits).toHaveLength(2);
  });
});

describe("selectHits без порога", () => {
  it("только ограничивает top-K и не смотрит на score", () => {
    const candidates = [searchHit(1, "a.md", 0.1), searchHit(2, "b.md", -0.5), searchHit(3, "c.md", 0.05)];
    const selection = selectHits(candidates, { filter: false, threshold: 0.9, topK: 2 });
    expect(files(selection.hits)).toEqual(["a.md", "b.md"]);
    expect(selection.belowThreshold).toEqual([]);
    expect(files(selection.overLimit)).toEqual(["c.md"]);
  });
});

describe("selectForMode", () => {
  const candidates = [searchHit(1, "a.md", 0.9), searchHit(2, "b.md", 0.3)];
  const params = { candidateTopK: 10, topK: 5, threshold: 0.5 };

  it.each([
    ["baseline", 2],
    ["filter", 1],
    ["rewrite", 2],
    ["rewrite-filter", 1],
  ] as const)("режим %s передаёт модели %i чанк(а)", (mode, count) => {
    expect(selectForMode(mode, candidates, params).hits).toHaveLength(count);
  });
});
