import { posix } from "node:path";
import type { JsonObject, ToolDefinition, ToolResult, ToolSource } from "../../core/index.ts";
import type { FileChange } from "./types.ts";

export const EDIT_TOOL_NAME = "propose_edit";
export const MAX_EDITED_FILES = 10;

export type EditProposalsOptions = Readonly<{
  /** Читает файл проекта; результат — как у `files_read`: текст файла или ошибка. */
  read: (path: string) => Promise<ToolResult>;
  onProposal: (path: string, accepted: boolean) => void;
}>;

const definition: ToolDefinition = {
  name: EDIT_TOOL_NAME,
  description:
    "Предлагает правку Markdown-файла (.md): фрагмент old заменяется на new. old — дословный фрагмент из files_read, " +
    "он должен встречаться в файле ровно один раз. Файл изменится только после подтверждения человека.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Путь к .md-файлу относительно корня проекта." },
      old: { type: "string", description: "Заменяемый фрагмент, дословно из файла; встречается один раз." },
      new: { type: "string", description: "Новый текст вместо old." },
    },
    required: ["path", "old", "new"],
    additionalProperties: false,
  },
};

const failure = (content: string): ToolResult => ({ content, isError: true });

const isRelative = (path: string) =>
  path !== "" && !path.startsWith("/") && !/^[A-Za-z]:/.test(path) && !path.split(/[\\/]/).includes("..");

function countOccurrences(text: string, fragment: string): number {
  return text.split(fragment).length - 1;
}

/** Копит правки в памяти, файлы не меняются; ошибка валидации — результат `isError`, чтобы модель могла исправиться. */
export function createEditProposals(options: EditProposalsOptions): {
  source: ToolSource;
  changes(): readonly FileChange[];
} {
  const changes = new Map<string, { before: string; after: string; edits: number }>();

  async function apply(args: JsonObject): Promise<ToolResult> {
    const { path, old, new: replacement } = args;
    if (typeof path !== "string" || typeof old !== "string" || typeof replacement !== "string") {
      return failure("Аргументы path, old и new должны быть строками.");
    }
    if (old === "") return failure("Фрагмент old не может быть пустым.");
    if (old === replacement) return failure("Фрагмент new совпадает с old: правка ничего не меняет.");
    if (!isRelative(path) || !path.endsWith(".md")) {
      return failure("Путь должен быть относительным, без «..», и указывать на файл .md.");
    }
    const key = posix.normalize(path);
    let entry = changes.get(key);
    if (!entry) {
      if (changes.size >= MAX_EDITED_FILES)
        return failure(`Можно править не больше ${MAX_EDITED_FILES} файлов за раз.`);
      const read = await options.read(key);
      if (read.isError) return failure(read.content);
      entry = { before: read.content, after: read.content, edits: 0 };
    }
    const found = countOccurrences(entry.after, old);
    if (found === 0) return failure(`Фрагмент old не найден в ${key}.`);
    if (found > 1) return failure(`Фрагмент old встречается ${found} раз — расширьте его, чтобы он был уникальным.`);
    const start = entry.after.indexOf(old);
    const after = entry.after.slice(0, start) + replacement + entry.after.slice(start + old.length);
    changes.set(key, { before: entry.before, after, edits: entry.edits + 1 });
    return {
      content: `Правка принята для ${key}; файл будет изменён только после подтверждения человека.`,
      isError: false,
    };
  }

  const source: ToolSource = {
    listTools: async () => [definition],
    callTool: async ({ name, arguments: args }) => {
      if (name !== EDIT_TOOL_NAME) throw new Error("Неизвестный инструмент правок.");
      const result = await apply(args);
      options.onProposal(typeof args.path === "string" ? args.path : "?", !result.isError);
      return result;
    },
  };
  return {
    source,
    changes: () =>
      [...changes].flatMap(([path, change]) => (change.after === change.before ? [] : [{ path, ...change }])),
  };
}
