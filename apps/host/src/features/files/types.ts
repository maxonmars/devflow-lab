/** Итог правок одного файла: `before` — содержимое при первой правке, `after` — после всех принятых. */
export type FileChange = Readonly<{ path: string; before: string; after: string; edits: number }>;
