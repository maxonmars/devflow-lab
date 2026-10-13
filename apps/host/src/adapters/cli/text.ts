export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.replaceAll(/\s+/g, " ").trim().split(" ")) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  return line ? [...lines, line] : lines;
}
