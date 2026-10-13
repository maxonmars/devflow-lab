import { describe, expect, it, vi } from "vitest";
import { RagError } from "../errors.ts";
import { createOllamaEmbeddings } from "../ollama.ts";

const OPTIONS = { baseUrl: "http://ollama.test:11434/", model: "bge-m3", timeoutMs: 1000 };
const json = (body: unknown, status = 200) => Response.json(body, { status });
const create = (fetch: typeof globalThis.fetch) => createOllamaEmbeddings({ ...OPTIONS, fetch });
const codeOf = async (promise: Promise<unknown>): Promise<RagError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RagError) return error;
    throw error;
  }
  throw new Error("ошибка не выброшена");
};

describe("адаптер Ollama", () => {
  it("отправляет пакет в /api/embed с truncate: false и переводит наносекунды в миллисекунды", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      json({
        embeddings: [
          [0.1, 0.2],
          [0.3, 0.4],
        ],
        prompt_eval_count: 17,
        load_duration: 2_500_000,
      }),
    );
    const result = await create(fetch).embed(["один", "два"]);
    expect(result).toEqual({
      vectors: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      promptTokens: 17,
      loadDurationMs: 2.5,
    });
    const [url, init = {}] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("http://ollama.test:11434/api/embed");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ model: "bge-m3", input: ["один", "два"], truncate: false });
  });

  it("digest модели берётся из /api/tags; имя без тега совпадает с :latest", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      json({
        models: [
          { name: "other:latest", digest: "aaa" },
          { name: "bge-m3:latest", digest: "790764642607" },
        ],
      }),
    );
    expect(await create(fetch).describeModel()).toEqual({ name: "bge-m3:latest", digest: "790764642607" });
    expect(fetch.mock.calls[0]?.[0]).toBe("http://ollama.test:11434/api/tags");
    const missing = create(async () => json({ models: [{ name: "other:latest", digest: "aaa" }] }));
    expect((await codeOf(missing.describeModel())).code).toBe("MODEL_NOT_FOUND");
  });

  it.each([
    [404, { error: 'model "bge-m3" not found, try pulling it first' }, "MODEL_NOT_FOUND"],
    [400, { error: "the input length exceeds the context length" }, "EMBEDDING_INPUT_TOO_LONG"],
    [400, { error: "другая ошибка" }, "EMBEDDING_HTTP_ERROR"],
    [500, { error: "internal" }, "EMBEDDING_HTTP_ERROR"],
  ])("HTTP %s → %s", async (status, body, code) => {
    const error = await codeOf(create(async () => json(body, status)).embed(["a"]));
    expect(error.code).toBe(code);
    expect(JSON.stringify(error.data)).not.toContain("internal");
  });

  it("недоступный сервер и таймаут — разные ошибки", async () => {
    const refused = await codeOf(create(async () => Promise.reject(new TypeError("fetch failed"))).embed(["a"]));
    expect(refused).toMatchObject({ code: "OLLAMA_UNAVAILABLE", data: { baseUrl: "http://ollama.test:11434" } });
    const timeout = await codeOf(
      create(async () => Promise.reject(new DOMException("timed out", "TimeoutError"))).embed(["a"]),
    );
    expect(timeout.code).toBe("EMBEDDING_TIMEOUT");
  });

  it("ответ без prompt_eval_count или не JSON — некорректные эмбеддинги", async () => {
    const noTokens = await codeOf(create(async () => json({ embeddings: [[1]] })).embed(["a"]));
    expect(noTokens).toMatchObject({ code: "INVALID_EMBEDDINGS", data: { reason: "format" } });
    const notJson = await codeOf(create(async () => new Response("не json")).embed(["a"]));
    expect(notJson).toMatchObject({ code: "INVALID_EMBEDDINGS", data: { reason: "format" } });
  });
});
