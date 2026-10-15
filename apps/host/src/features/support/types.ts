/** Заголовки разделов ответа модели, в этом порядке. */
export const SUPPORT_SECTIONS = {
  answer: "Ответ",
  sources: "Источники",
  ticket: "Данные тикета",
} as const;

export type SupportSection = keyof typeof SUPPORT_SECTIONS;

/** Фрагмент документации продукта; `rank` — номер `[N]`, на который ссылается ответ. */
export type SupportDoc = Readonly<{
  rank: number;
  file: string;
  title: string;
  sections: readonly string[];
  text: string;
}>;

/** `ticket` — готовый текст инструмента `get_ticket`; фича его не разбирает. */
export type SupportInput = Readonly<{
  ticketId: string;
  ticket: string;
  question: string;
  docs: readonly SupportDoc[];
}>;

/** `missing` — разделы без заголовка; `unknownSources` — номера из «Источников», которых нет среди фрагментов. */
export type SupportResult = Readonly<{
  text: string;
  missing: readonly SupportSection[];
  unknownSources: readonly number[];
}>;
