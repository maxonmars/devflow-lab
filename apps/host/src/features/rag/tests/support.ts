import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { vi } from "vitest";
import type { ModelPort, ModelRequest } from "../../../core/index.ts";
import type { LoadedDocument } from "../corpus.ts";
import type { EmbedBatch, EmbeddingPort } from "../embeddings.ts";
import { parseBlocks } from "../markdown.ts";
import type { SearchHit, SearchIndex } from "../search.ts";
import { CodePointText, sha256 } from "../text.ts";
import type { ChunkParams } from "../types.ts";

export const PARAMS: ChunkParams = { chunkSizeChars: 100, overlapChars: 20, minChunkChars: 40 };

export type FakeEmbeddings = EmbeddingPort & { calls: string[][]; failOnCall: number | undefined };

/** Детерминированные векторы из sha256 текста; `failOnCall` — номер вызова embed (с 1), который завершится ошибкой. */
export function fakeEmbeddings(dimension = 3): FakeEmbeddings {
  const port: FakeEmbeddings = {
    calls: [],
    failOnCall: undefined,
    async embed(texts): Promise<EmbedBatch> {
      port.calls.push([...texts]);
      if (port.failOnCall === port.calls.length) throw new Error("сбой эмбеддингов");
      return {
        vectors: texts.map((text) =>
          [...createHash("sha256").update(text).digest().subarray(0, dimension)].map((byte) => byte / 255),
        ),
        promptTokens: texts.reduce((sum, text) => sum + text.length, 0),
        loadDurationMs: 5,
      };
    },
    async describeModel() {
      return { name: "fake:latest", digest: "0123456789abcdef" };
    },
  };
  return port;
}

/** Вектор — число вхождений слов словаря в текст: близость запроса к чанку задаётся общими словами. */
export function keywordEmbeddings(vocabulary: readonly string[]): FakeEmbeddings {
  const count = (text: string, word: string) => text.toLowerCase().split(word).length - 1;
  const port = fakeEmbeddings(vocabulary.length);
  port.embed = async (texts): Promise<EmbedBatch> => {
    port.calls.push([...texts]);
    return {
      vectors: texts.map((text) => vocabulary.map((word) => count(text, word))),
      promptTokens: texts.length,
      loadDurationMs: 1,
    };
  };
  return port;
}

export function writeCorpus(root: string, files: Readonly<Record<string, string>>): void {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
}

export function documentOf(text: string, file = "doc.md", title = "Doc"): LoadedDocument {
  const content = new CodePointText(text);
  return { file, source: `src/${file}`, title, hash: sha256(text), content, blocks: parseBlocks(content).blocks };
}

export function searchHit(rank: number, file: string, score: number, text = `текст ${file}`): SearchHit {
  return {
    rank,
    score,
    chunk: {
      chunk_id: `${file}#${rank}`,
      strategy: "structure",
      source: "src",
      title: "Doc",
      file,
      sections: [`Doc › ${file}`],
      start: 0,
      end: 1,
      text,
    },
  };
}

/** Индекс без диска: `search` возвращает кандидатов по тексту запроса и записывается как mock. */
export function fakeSearchIndex(
  results: (query: string) => readonly SearchHit[],
  files: readonly string[] = ["a.md", "b.md", "c.md"],
) {
  const search = vi.fn(async (query: string) => results(query));
  const index: SearchIndex = {
    createdAt: "2026-09-29T10:00:00.000Z",
    model: { name: "bge-m3:latest", digest: "790764642607abcdef", dimension: 2 },
    files,
    search,
  };
  return { index, search };
}

export type FakeModelOptions = Readonly<{
  rewrite?: (question: string) => string;
  answer?: (user: string) => string;
  /** Номер вызова этого вида (с 1), который завершится ошибкой; без `error` — обычный `Error`. */
  failOn?: Readonly<{ kind: "rewrite" | "answer"; call: number; error?: Error }>;
  onCall?: (kind: "rewrite" | "answer") => void;
}>;

/** Модель различает запросы по системной инструкции: rewrite — «переписываешь», иначе ответ по фрагментам. */
export function fakeModel(options: FakeModelOptions = {}) {
  const requests: ModelRequest[] = [];
  const kinds: ("rewrite" | "answer")[] = [];
  const model: ModelPort = {
    async complete(request) {
      requests.push(request);
      const kind = String(request.messages[0]?.content).includes("переписываешь") ? "rewrite" : "answer";
      kinds.push(kind);
      options.onCall?.(kind);
      const call = kinds.filter((item) => item === kind).length;
      if (options.failOn?.kind === kind && options.failOn.call === call)
        throw options.failOn.error ?? new Error("сбой модели");
      const user = String(request.messages[1]?.content);
      const rewrite = options.rewrite ?? ((question: string) => `запрос: ${question}`);
      const answer = options.answer ?? ((text: string) => `ответ: ${text.slice(-30)}`);
      return { type: "text", content: kind === "rewrite" ? rewrite(user) : answer(user) };
    },
  };
  return { model, requests, kinds };
}
