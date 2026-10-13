import { InputError } from "../adapters/cli/index.ts";
import type { DeepSeekOptions, LocalModelOptions } from "../adapters/llm/index.ts";
import type { ModelPort } from "../core/index.ts";
import type { ResolvedConfig } from "./config.ts";

export type ModelOptions =
  | (DeepSeekOptions & Readonly<{ provider: "deepseek" }>)
  | (LocalModelOptions & Readonly<{ provider: "local" }>);

export type CreateModel = (options: ModelOptions) => ModelPort;

export function requireApiKey(config: ResolvedConfig): string {
  const apiKey = config.values["llm.apiKey"];
  if (!apiKey) throw new InputError("Задайте LAB_LLM_API_KEY в окружении процесса.");
  return apiKey;
}

/** Подпись модели для заголовков отчётов: провайдер и имя. */
export function modelLabel(config: ResolvedConfig): string {
  const { values } = config;
  return values["llm.provider"] === "local"
    ? `local · ${values["llm.localModel"]}`
    : `deepseek · ${values["llm.model"]}`;
}

/** Модель создаётся лениво, поэтому справка, настройки и discovery работают без ключа. */
export function createConfiguredModel(config: ResolvedConfig, createModel: CreateModel): ModelPort {
  const { values } = config;
  if (values["llm.provider"] === "local") {
    return createModel({
      provider: "local",
      baseUrl: values["llm.localBaseUrl"],
      model: values["llm.localModel"],
      timeoutMs: values["llm.localTimeoutMs"],
      maxOutputTokens: values["llm.maxOutputTokens"],
      ...(values["llm.localApiKey"] ? { apiKey: values["llm.localApiKey"] } : {}),
    });
  }
  return createModel({
    provider: "deepseek",
    apiKey: requireApiKey(config),
    model: values["llm.model"],
    timeoutMs: values["llm.timeoutMs"],
    maxOutputTokens: values["llm.maxOutputTokens"],
  });
}
