import { z } from "zod";
import type { EmbeddingPort } from "./embeddings.ts";
import { RagError } from "./errors.ts";

export type OllamaOptions = Readonly<{
  baseUrl: string;
  model: string;
  timeoutMs: number;
  fetch?: typeof globalThis.fetch;
}>;

const NANOSECONDS_PER_MS = 1_000_000;

const embedResponse = z.object({
  embeddings: z.array(z.array(z.number())),
  prompt_eval_count: z.number(),
  load_duration: z.number().optional(),
});
const tagsResponse = z.object({ models: z.array(z.object({ name: z.string(), digest: z.string() })) });

async function errorText(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => ({}));
  return typeof body === "object" && body !== null && "error" in body ? String(body.error) : "";
}

/** Адаптер Ollama `/api/embed`: текст ошибки провайдера в ошибку не попадает, по нему выбирается только код. */
export function createOllamaEmbeddings(options: OllamaOptions): EmbeddingPort {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const send = options.fetch ?? globalThis.fetch;

  async function request(path: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await send(`${baseUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") throw new RagError("EMBEDDING_TIMEOUT");
      throw new RagError("OLLAMA_UNAVAILABLE", { baseUrl });
    }
    if (!response.ok) {
      if (response.status === 404) throw new RagError("MODEL_NOT_FOUND", { model: options.model });
      if (response.status === 400 && /context length/i.test(await errorText(response))) {
        throw new RagError("EMBEDDING_INPUT_TOO_LONG");
      }
      throw new RagError("EMBEDDING_HTTP_ERROR", { status: response.status });
    }
    return response.json().catch(() => {
      throw new RagError("INVALID_EMBEDDINGS", { reason: "format" });
    });
  }

  return {
    async embed(texts) {
      const parsed = embedResponse.safeParse(
        await request("/api/embed", { model: options.model, input: texts, truncate: false }),
      );
      if (!parsed.success) throw new RagError("INVALID_EMBEDDINGS", { reason: "format" });
      return {
        vectors: parsed.data.embeddings,
        promptTokens: parsed.data.prompt_eval_count,
        loadDurationMs: (parsed.data.load_duration ?? 0) / NANOSECONDS_PER_MS,
      };
    },
    async describeModel() {
      const parsed = tagsResponse.safeParse(await request("/api/tags"));
      if (!parsed.success) throw new RagError("INVALID_EMBEDDINGS", { reason: "format" });
      const found = parsed.data.models.find(
        (item) => item.name === options.model || item.name === `${options.model}:latest`,
      );
      if (!found) throw new RagError("MODEL_NOT_FOUND", { model: options.model });
      return { name: found.name, digest: found.digest };
    },
  };
}
