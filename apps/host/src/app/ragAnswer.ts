import type { CliView } from "../adapters/cli/index.ts";
import { answerWithRag, openIndex, renderCitedAnswer, type SearchHit } from "../features/rag/index.ts";
import { systemPrompt } from "./ask.ts";
import type { ResolvedConfig } from "./config.ts";
import { type CreateEmbeddings, configuredEmbeddings, ragPaths } from "./embeddings.ts";
import { type CreateModel, createConfiguredModel, modelLabel } from "./model.ts";
import { retrievalSettings } from "./retrieval.ts";

export type RagReply = Readonly<{ answer: string; fragments: readonly string[] }>;

export type RagAnswerHandlerOptions = Readonly<{
  cwd: string;
  getConfig: () => ResolvedConfig;
  createModel: CreateModel;
  createEmbeddings?: CreateEmbeddings | undefined;
  view: CliView;
}>;

/** Строка на фрагмент: ранг, файл, первый раздел, сходство; остальные разделы — суффикс `(+N)`. */
export function fragmentLines(hits: readonly SearchHit[]): string[] {
  return hits.map(({ rank, score, chunk }) => {
    const more = chunk.sections.length > 1 ? ` (+${chunk.sections.length - 1})` : "";
    return `${rank}. ${chunk.file} › ${chunk.sections[0] ?? chunk.title} · ${score.toFixed(2)}${more}`;
  });
}

// Параметры проверяются первыми, модель создаётся до индекса: ошибка ключа приходит раньше, чем обращение к Ollama.
export async function prepareRag(options: RagAnswerHandlerOptions) {
  const config = options.getConfig();
  const retrieval = retrievalSettings(config);
  const paths = ragPaths(options.cwd, config);
  const model = createConfiguredModel(config, options.createModel);
  const embeddings = configuredEmbeddings(config, options.createEmbeddings);
  const index = await openIndex({ indexFile: paths.indexFile, embeddings });
  return {
    values: config.values,
    paths,
    model,
    modelName: modelLabel(config),
    index,
    retrieval,
    answerPrompt: config.values["rag.answerPrompt"],
  };
}

export function createRagAnswerHandlers(options: RagAnswerHandlerOptions) {
  const prepare = () => prepareRag(options);

  return {
    async ask(text: string): Promise<RagReply> {
      const { values, model, index, retrieval, answerPrompt } = await prepare();
      const mode = values["rag.retrievalMode"];
      const result = await answerWithRag({
        question: text,
        index,
        model,
        systemPrompt: systemPrompt(),
        answerPrompt,
        mode,
        ...retrieval,
      });
      return { answer: renderCitedAnswer(result.answer), fragments: fragmentLines(result.hits) };
    },
  };
}
