import type { CliView } from "../adapters/cli/index.ts";
import { type IndexResult, indexCorpus } from "../features/rag/index.ts";
import type { ResolvedConfig } from "./config.ts";
import { type CreateEmbeddings, configuredEmbeddings, ragPaths } from "./embeddings.ts";

export type RagHandlerOptions = Readonly<{
  cwd: string;
  getConfig: () => ResolvedConfig;
  view: CliView;
  createEmbeddings?: CreateEmbeddings | undefined;
}>;

export type RagOutcome = Readonly<{ lines: readonly string[]; path: string }>;

const integer = (value: number) =>
  Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");

function indexLines(result: IndexResult): string[] {
  const { stats } = result;
  const seconds = (stats.embeddingMs / 1000).toFixed(1);
  return [
    `Документов: ${result.documents}, символов: ${integer(result.chars)}`,
    `Модель: ${result.model.name}, digest ${result.model.digest.slice(0, 12)}, размерность ${result.model.dimension}`,
    `Чанков: ${integer(stats.chunks)}, токенов ${integer(stats.promptTokens)}, эмбеддинги ${seconds} с`,
  ];
}

export function createRagHandlers(options: RagHandlerOptions) {
  return {
    async index(): Promise<RagOutcome> {
      const config = options.getConfig();
      const { values } = config;
      const paths = ragPaths(options.cwd, config);
      const result = await indexCorpus({
        projectRoot: paths.projectRoot,
        include: paths.include,
        outputFile: paths.indexFile,
        params: {
          chunkSizeChars: values["rag.chunkSizeChars"],
          overlapChars: values["rag.overlapChars"],
          minChunkChars: values["rag.minChunkChars"],
        },
        embeddings: configuredEmbeddings(config, options.createEmbeddings),
        onProgress: (event) =>
          options.view.progress(`${event.stage === "chunked" ? "Разбиение" : "Эмбеддинги"}: чанков ${event.chunks}`),
      });
      return { lines: indexLines(result), path: result.path };
    },
  };
}
