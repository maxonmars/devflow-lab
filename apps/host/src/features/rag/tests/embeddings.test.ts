import { describe, expect, it } from "vitest";
import { EMBED_BATCH_SIZE, type EmbedBatch, type EmbeddingPort, embedAll } from "../embeddings.ts";
import { RagError } from "../errors.ts";
import { fakeEmbeddings } from "./support.ts";

const portReturning = (batches: EmbedBatch[]): EmbeddingPort => {
  let call = 0;
  return {
    embed: async () => batches[call++] ?? { vectors: [], promptTokens: 0, loadDurationMs: 0 },
    describeModel: async () => ({ name: "m", digest: "d" }),
  };
};
const batch = (vectors: number[][]): EmbedBatch => ({ vectors, promptTokens: 10, loadDurationMs: 1 });
const reasonOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error instanceof RagError ? `${error.code}:${error.data.reason}` : "OTHER";
  }
  return "NONE";
};

describe("embedAll", () => {
  it("отправляет последовательные пакеты по EMBED_BATCH_SIZE и суммирует токены", async () => {
    const port = fakeEmbeddings(2);
    const texts = Array.from({ length: 20 }, (_, index) => `текст ${index}`);
    const result = await embedAll(port, texts);
    expect(port.calls.map((call) => call.length)).toEqual([EMBED_BATCH_SIZE, EMBED_BATCH_SIZE, 4]);
    expect(port.calls.flat()).toEqual(texts);
    expect(result.vectors).toHaveLength(20);
    expect(result.dimension).toBe(2);
    expect(result.promptTokens).toBe(texts.reduce((sum, text) => sum + text.length, 0));
    expect(result.loadDurationMs).toBe(15);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("не повторяет запрос после сбоя", async () => {
    const port = fakeEmbeddings();
    port.failOnCall = 1;
    await expect(embedAll(port, ["a", "b"])).rejects.toThrow("сбой эмбеддингов");
    expect(port.calls).toHaveLength(1);
  });

  it("отклоняет число векторов, не равное числу текстов", async () => {
    expect(await reasonOf(embedAll(portReturning([batch([[1]])]), ["a", "b"]))).toBe("INVALID_EMBEDDINGS:count");
  });

  it("отклоняет пустой вектор, нечисловое значение и смену размерности", async () => {
    expect(await reasonOf(embedAll(portReturning([batch([[]])]), ["a"]))).toBe("INVALID_EMBEDDINGS:empty");
    expect(await reasonOf(embedAll(portReturning([batch([[1, Number.NaN]])]), ["a"]))).toBe("INVALID_EMBEDDINGS:value");
    expect(await reasonOf(embedAll(portReturning([batch([[1, Number.POSITIVE_INFINITY]])]), ["a"]))).toBe(
      "INVALID_EMBEDDINGS:value",
    );
    const eight = batch(Array.from({ length: EMBED_BATCH_SIZE }, () => [1, 2]));
    expect(await reasonOf(embedAll(portReturning([eight, batch([[1]])]), Array(EMBED_BATCH_SIZE + 1).fill("a")))).toBe(
      "INVALID_EMBEDDINGS:dimension",
    );
    expect(await reasonOf(embedAll(portReturning([batch([[1, 2]])]), ["a"], 3))).toBe("INVALID_EMBEDDINGS:dimension");
  });
});
