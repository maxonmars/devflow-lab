import type { BranchInfo, ChangesInfo, DiffInfo, FileInfo, FilesInfo, StatusInfo } from "../git/readers.ts";

export function branchText(info: BranchInfo): string {
  const head = info.head ? `${info.head.sha} ${info.head.subject}` : "коммитов пока нет";
  return info.branch === null ? `HEAD отсоединён от ветки (detached): ${head}` : `Ветка: ${info.branch}\nHEAD: ${head}`;
}

export function statusText(info: StatusInfo): string {
  const [branchLine, ...changes] = info.lines;
  const body = changes.length > 0 ? changes.join("\n") : "Изменений нет.";
  const cut = info.truncated ? `\nПоказано ${info.lines.length} из ${info.total} строк.` : "";
  return `${branchLine ?? ""}\n${body}${cut}`.trim();
}

export function diffText(info: DiffInfo, staged: boolean, base?: string): string {
  const scope =
    base !== undefined
      ? `Изменения относительно ${base} (base...HEAD)`
      : staged
        ? "Изменения в индексе (staged)"
        : "Изменения рабочей копии (не в индексе)";
  if (!info.stat) return `${scope}: изменений нет.`;
  const cut = info.truncated
    ? `\n\nDiff обрезан: показано ${[...info.diff].length} из ${info.totalChars} символов.`
    : "";
  return `${scope}:\n${info.stat}\n\n${info.diff}${cut}`;
}

export function filesText(info: FilesInfo, path: string | undefined): string {
  const where = path ? ` в ${path}` : "";
  if (info.total === 0) return `Отслеживаемых файлов${where} нет.`;
  const cut = info.truncated ? `\nПоказано ${info.files.length} из ${info.total}.` : "";
  return `Отслеживаемые файлы${where} (${info.total}):\n${info.files.join("\n")}${cut}`;
}

/** Текст разбирает host (`review`): строки `<буква> <путь>`, у R и C — `<буква> <новый путь> ← <старый путь>`. */
export function changesText(info: ChangesInfo, base: string): string {
  if (info.total === 0) return `Изменённых файлов относительно ${base} нет.`;
  const lines = info.files.map((file) =>
    file.from === undefined ? `${file.status} ${file.path}` : `${file.status} ${file.path} ← ${file.from}`,
  );
  const cut = info.truncated ? `\nПоказано ${info.files.length} из ${info.total}.` : "";
  return `Изменённые файлы относительно ${base} (${info.total}):\n${lines.join("\n")}${cut}`;
}

/** Забор длиннее любой серии обратных кавычек в тексте, чтобы содержимое файла не закрыло блок. */
function fence(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  return "`".repeat(longest + 1);
}

export function fileText(info: FileInfo): string {
  if (info.binary) return `Файл ${info.path} двоичный, содержимое не показывается.`;
  const shown = info.truncated ? `, показано ${[...info.content].length}` : "";
  const mark = fence(info.content);
  const body = info.content.endsWith("\n") ? info.content : `${info.content}\n`;
  return `Файл ${info.path} в HEAD (${info.totalChars} символов${shown}):\n${mark}\n${body}${mark}`;
}
