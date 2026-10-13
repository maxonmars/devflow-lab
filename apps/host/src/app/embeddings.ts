import { join, resolve } from "node:path";
import { createOllamaEmbeddings, type EmbeddingPort, type OllamaOptions } from "../features/rag/index.ts";
import type { ResolvedConfig } from "./config.ts";

export type CreateEmbeddings = (options: OllamaOptions) => EmbeddingPort;

export function configuredEmbeddings(
  config: ResolvedConfig,
  create: CreateEmbeddings | undefined = createOllamaEmbeddings,
): EmbeddingPort {
  const { values } = config;
  return create({
    baseUrl: values["rag.embeddingBaseUrl"],
    model: values["rag.embeddingModel"],
    timeoutMs: values["rag.embeddingTimeoutMs"],
  });
}

export type RagPaths = Readonly<{ projectRoot: string; include: readonly string[]; indexFile: string }>;

export function ragPaths(cwd: string, config: ResolvedConfig): RagPaths {
  const { values } = config;
  return {
    projectRoot: resolve(cwd, values["project.root"]),
    include: values["rag.include"],
    indexFile: join(resolve(cwd, values["rag.outputDir"]), "index.json"),
  };
}
