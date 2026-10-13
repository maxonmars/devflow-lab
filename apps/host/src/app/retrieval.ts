import { checkRetrievalParams, type RetrievalParams, type Strategy } from "../features/rag/index.ts";
import type { ResolvedConfig } from "./config.ts";

export type RetrievalSettings = RetrievalParams & Readonly<{ strategy: Strategy }>;

/** Параметры поиска из настроек; согласованность проверяется здесь, до обращения к Ollama и модели. */
export function retrievalSettings(config: ResolvedConfig): RetrievalSettings {
  const { values } = config;
  const settings = {
    strategy: values["rag.chunkStrategy"],
    candidateTopK: values["rag.candidateTopK"],
    topK: values["rag.topK"],
    threshold: values["rag.similarityThreshold"],
  };
  checkRetrievalParams(settings);
  return settings;
}
