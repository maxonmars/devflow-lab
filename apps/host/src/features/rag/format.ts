/** Забор для блока кода: длиннее любой серии обратных кавычек в тексте. */
export function fence(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  return "`".repeat(longest + 1);
}
