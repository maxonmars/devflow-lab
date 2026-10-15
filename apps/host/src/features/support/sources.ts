import { SUPPORT_SECTIONS } from "./types.ts";

/** Строки раздела «Источники» (`from` включительно, `to` исключительно) и номера `[N]` из него; без раздела — `undefined`. */
export function sourcesSection(lines: readonly string[]): { from: number; to: number; ranks: number[] } | undefined {
  const heading = lines.findIndex((line) => /^##[ \t]+(.+)$/.exec(line)?.[1]?.trim() === SUPPORT_SECTIONS.sources);
  if (heading < 0) return undefined;
  const next = lines.findIndex((line, position) => position > heading && /^##[ \t]/.test(line));
  const to = next < 0 ? lines.length : next;
  const body = lines.slice(heading + 1, to).join("\n");
  const ranks = [...new Set([...body.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])))];
  return { from: heading + 1, to, ranks };
}
