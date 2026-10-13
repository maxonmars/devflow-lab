import { checkRetrievalParams, type RetrievalParams } from "../features/rag/index.ts";
import type { ResolvedConfig } from "./config.ts";

/** Параметры поиска из настроек; согласованность проверяется здесь, до обращения к Ollama и модели. */
export function retrievalSettings(config: ResolvedConfig): RetrievalParams {
  const { values } = config;
  const settings = {
    candidateTopK: values["rag.candidateTopK"],
    topK: values["rag.topK"],
    threshold: values["rag.similarityThreshold"],
  };
  checkRetrievalParams(settings);
  return settings;
}
