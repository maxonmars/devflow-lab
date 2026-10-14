/** Заголовки разделов ответа модели, в этом порядке. */
export const REVIEW_SECTIONS = {
  bugs: "Потенциальные баги",
  architecture: "Архитектурные проблемы",
  recommendations: "Рекомендации",
} as const;

export type ReviewSection = keyof typeof REVIEW_SECTIONS;

/** Фрагмент документации проекта; `rank` — номер `[N]`, на который ссылается ревью. */
export type ReviewDoc = Readonly<{
  rank: number;
  file: string;
  title: string;
  sections: readonly string[];
  text: string;
}>;

/** `diff` и `content` — готовые тексты инструментов `git_diff` и `read_file`; у удалённого файла `content` нет. */
export type ReviewFile = Readonly<{ path: string; status: string; from?: string; diff: string; content?: string }>;

/** `omitted` — пути изменённых файлов, которые не поместились в контекст. */
export type ReviewInput = Readonly<{
  base: string;
  files: readonly ReviewFile[];
  omitted: readonly string[];
  docs: readonly ReviewDoc[];
}>;

/** `missing` — разделы, которых нет в ответе модели; повторного вызова не бывает. */
export type ReviewResult = Readonly<{ text: string; missing: readonly ReviewSection[] }>;
