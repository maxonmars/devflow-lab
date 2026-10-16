import type { SearchInfo } from "../files/readers.ts";

export function searchText(info: SearchInfo, query: string): string {
  if (info.total === 0) return `Совпадений «${query}» нет.`;
  const lines = info.matches.map((match) => `${match.path}:${match.line}: ${match.text}`);
  const cut = info.truncated ? `\nПоказано ${info.matches.length} из ${info.total}.` : "";
  return `Совпадения «${query}» (${info.total}):\n${lines.join("\n")}${cut}`;
}
