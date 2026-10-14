import { describe, expect, it } from "vitest";
import { RagError } from "../errors.ts";
import { searchQueries } from "../multiSearch.ts";
import { fakeSearchIndex, searchHit } from "./support.ts";

const PARAMS = { candidateTopK: 10, topK: 3, threshold: 0.5 };

describe("searchQueries", () => {
  it("объединяет чанки по chunk_id с максимальным score, отсекает порог и пересчитывает ранги", async () => {
    const { index, search } = fakeSearchIndex((query) =>
      query === "первый"
        ? [searchHit(1, "a.md", 0.6), searchHit(2, "b.md", 0.55), searchHit(3, "low.md", 0.4)]
        : [searchHit(1, "b.md", 0.9), searchHit(2, "c.md", 0.7)],
    );
    const hits = await searchQueries({ index, queries: ["первый", "второй"], ...PARAMS });
    expect(search.mock.calls).toEqual([
      ["первый", 10],
      ["второй", 10],
    ]);
    expect(hits.map((hit) => [hit.rank, hit.chunk.file, hit.score])).toEqual([
      [1, "b.md", 0.9],
      [2, "c.md", 0.7],
      [3, "a.md", 0.6],
    ]);
  });

  it("обрезает до topK; при равном score порядок первого появления", async () => {
    const { index } = fakeSearchIndex((query) =>
      query === "x" ? [searchHit(1, "a.md", 0.8), searchHit(2, "b.md", 0.8)] : [searchHit(1, "c.md", 0.8)],
    );
    const hits = await searchQueries({ index, queries: ["x", "y"], ...PARAMS, topK: 2 });
    expect(hits.map((hit) => hit.chunk.file)).toEqual(["a.md", "b.md"]);
  });

  it("пустые запросы не ищутся, пустой список — без обращения к эмбеддингам", async () => {
    const { index, search } = fakeSearchIndex(() => [searchHit(1, "a.md", 0.9)]);
    expect(await searchQueries({ index, queries: [], ...PARAMS })).toEqual([]);
    expect(await searchQueries({ index, queries: ["  "], ...PARAMS })).toEqual([]);
    expect(search).not.toHaveBeenCalled();
  });

  it("несогласованные параметры — INVALID_RETRIEVAL_PARAMS до первого поиска", async () => {
    const { index, search } = fakeSearchIndex(() => []);
    const error = await searchQueries({ index, queries: ["x"], candidateTopK: 2, topK: 3, threshold: 0.5 }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(RagError);
    expect((error as RagError).code).toBe("INVALID_RETRIEVAL_PARAMS");
    expect(search).not.toHaveBeenCalled();
  });
});
