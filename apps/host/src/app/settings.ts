import { z } from "zod";
import { ANSWER_PROMPTS, MAX_TOP_K, RETRIEVAL_MODES, SIMILARITY_RANGE, STRATEGIES } from "../features/rag/index.ts";
import { sections } from "./markdown.ts";

const descriptions = sections(new URL("./settings.md", import.meta.url));
export const LLM_PROVIDERS = ["deepseek", "local"] as const;
const positiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const insideRoot = (pattern: string) => !pattern.startsWith("/") && !pattern.split("/").includes("..");
// Список шаблонов задаётся строкой через запятую: так он одинаково читается из YAML, env и флага.
const globList = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().refine(insideRoot)).min(1));
export const DEFAULT_RAG_INCLUDE = [
  "README.md",
  "AGENTS.md",
  "ARCHITECTURE.md",
  "docs/**/*.md",
  "apps/*/README.md",
  "apps/*/AGENTS.md",
  "apps/*/src/**/README.md",
  "servers/*/README.md",
].join(",");

export const settings = {
  "config.file": { schema: z.string().trim().min(1), default: "lab.config.yaml", type: "string", file: false },
  "project.root": { schema: z.string().trim().min(1), default: ".", type: "string" },
  "llm.provider": { schema: z.enum(LLM_PROVIDERS), default: "deepseek", type: "string" },
  "llm.model": { schema: z.string().trim().min(1), default: "deepseek-flash", type: "string" },
  "llm.timeoutMs": { schema: positiveInteger, default: 30000, type: "number" },
  "llm.maxOutputTokens": { schema: positiveInteger, default: 1024, type: "number" },
  "llm.localBaseUrl": { schema: z.url(), default: "http://localhost:11434/v1", type: "string" },
  "llm.localModel": { schema: z.string().trim().min(1), default: "qwen3", type: "string" },
  "llm.localTimeoutMs": { schema: positiveInteger, default: 180000, type: "number" },
  "llm.apiKey": { schema: z.string().trim().min(1).nullable(), default: null, type: "string", secret: true },
  "llm.localApiKey": { schema: z.string().trim().min(1).nullable(), default: null, type: "string", secret: true },
  "rag.include": { schema: globList, default: DEFAULT_RAG_INCLUDE, type: "string" },
  "rag.outputDir": { schema: z.string().trim().min(1), default: ".local/rag", type: "string" },
  "rag.chunkSizeChars": { schema: positiveInteger, default: 1800, type: "number" },
  "rag.overlapChars": { schema: z.number().int().nonnegative(), default: 200, type: "number" },
  "rag.minChunkChars": { schema: positiveInteger, default: 500, type: "number" },
  "rag.embeddingBaseUrl": { schema: z.url(), default: "http://localhost:11434", type: "string" },
  "rag.embeddingModel": { schema: z.string().trim().min(1), default: "bge-m3", type: "string" },
  "rag.embeddingTimeoutMs": { schema: positiveInteger, default: 120000, type: "number" },
  "rag.chunkStrategy": { schema: z.enum(STRATEGIES), default: "structure", type: "string" },
  "rag.retrievalMode": { schema: z.enum(RETRIEVAL_MODES), default: "rewrite-filter", type: "string" },
  "rag.answerPrompt": { schema: z.enum(ANSWER_PROMPTS), default: "default", type: "string" },
  "rag.candidateTopK": { schema: z.number().int().min(1).max(MAX_TOP_K), default: 10, type: "number" },
  "rag.topK": { schema: z.number().int().min(1).max(MAX_TOP_K), default: 5, type: "number" },
  "rag.similarityThreshold": {
    schema: z.number().min(SIMILARITY_RANGE.min).max(SIMILARITY_RANGE.max),
    default: 0.55,
    type: "number",
  },
  "mcp.timeoutMs": { schema: positiveInteger, default: 10000, type: "number" },
} as const;

export type SettingKey = keyof typeof settings;
export type Values = { [K in SettingKey]: z.output<(typeof settings)[K]["schema"]> };

export const settingEntries = Object.entries(settings).map(([key, entry]) => ({
  ...entry,
  key: key as SettingKey,
  description: descriptions[key] ?? "",
  env: `LAB_${key
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replaceAll(".", "_")
    .toUpperCase()}`,
  flag: `--${key
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replaceAll(".", "-")
    .toLowerCase()}`,
  secret: "secret" in entry && entry.secret,
  file: !("file" in entry) && !("secret" in entry),
}));
