import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable, Writable } from "node:stream";
import { vi } from "vitest";
import type { ModelCompletion, ModelRequest } from "../../core/index.ts";
import type { EmbeddingPort } from "../../features/rag/index.ts";
import { run } from "../compose.ts";

export type CompleteMock = ReturnType<typeof vi.fn<(request: ModelRequest) => Promise<ModelCompletion>>>;

export type InvokeOptions = Readonly<{
  cwd: string;
  input?: string;
  authenticated?: boolean;
  color?: boolean;
  interactive?: boolean;
  complete?: CompleteMock;
  embeddings?: EmbeddingPort;
  /** Дополнительные переменные окружения процесса; ключ DeepSeek задаётся `authenticated`. */
  env?: Readonly<Record<string, string>>;
}>;

const echo = (request: ModelRequest): Promise<ModelCompletion> =>
  Promise.resolve({ type: "text", content: `Ответ: ${request.messages.at(-1)?.content}` });

function capture(color: boolean, sink: { text: string }): Writable {
  const stream = new Writable({
    write(chunk, _encoding, done) {
      sink.text += chunk.toString();
      done();
    },
  });
  return color ? Object.assign(stream, { isTTY: true, getColorDepth: () => 8 }) : stream;
}

export async function invoke(argv: string[], options: InvokeOptions) {
  const output = { text: "" };
  const error = { text: "" };
  const complete = options.complete ?? vi.fn(echo);
  const createModel = vi.fn(() => ({ complete }));
  const createEmbeddings = vi.fn(() => {
    if (!options.embeddings) throw new Error("createEmbeddings не должен вызываться");
    return options.embeddings;
  });
  const code = await run({
    argv,
    cwd: options.cwd,
    env: { ...(options.authenticated === false ? {} : { LAB_LLM_API_KEY: "test-key" }), ...options.env },
    createModel,
    createEmbeddings,
    terminal: {
      input: Readable.from([options.input ?? ""]),
      interactive: options.interactive ?? false,
      output: capture(options.color ?? false, output),
      error: capture(options.color ?? false, error),
    },
  });
  return { output: output.text, error: error.text, code, complete, createModel, createEmbeddings };
}

/** Детерминированный порт эмбеддингов без сети; тесты app не импортируют внутренности фичи. */
export function fakeEmbeddings(): EmbeddingPort {
  return {
    embed: async (texts) => ({
      vectors: texts.map((text) => [text.length, 1]),
      promptTokens: texts.length,
      loadDurationMs: 1,
    }),
    describeModel: async () => ({ name: "fake:latest", digest: "0123456789abcdef" }),
  };
}

/** Вектор — число вхождений слов словаря: близость запроса к чанку задаётся общими словами, остальные тексты дают нулевой вектор. */
export function keywordEmbeddings(vocabulary: readonly string[]): EmbeddingPort {
  const count = (text: string, word: string) => text.toLowerCase().split(word).length - 1;
  return {
    embed: async (texts) => ({
      vectors: texts.map((text) => vocabulary.map((word) => count(text, word))),
      promptTokens: texts.length,
      loadDurationMs: 1,
    }),
    describeModel: async () => ({ name: "fake:latest", digest: "0123456789abcdef" }),
  };
}

export function writeCorpus(root: string, files: Readonly<Record<string, string>>): void {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
}
