import type { BranchInfo, DiffInfo, FilesInfo, StatusInfo } from "../git/readers.ts";

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

export function diffText(info: DiffInfo, staged: boolean): string {
  const scope = staged ? "Изменения в индексе (staged)" : "Изменения рабочей копии (не в индексе)";
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
