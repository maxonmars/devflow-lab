import type { Writable } from "node:stream";
import type { Command } from "./commands.ts";
import { describeError } from "./errors.ts";
import { type Paint, painter } from "./paint.ts";
import { wrapText } from "./text.ts";

export type HelpSetting = Readonly<{ flag: string; type: string; description: string }>;
export type ConfigRow = Readonly<{ key: string; value: string; source: string }>;
/** Итог записи одного файла после подтверждения: `detail` — причина пропуска или текст ошибки. */
export type FileOutcome = Readonly<{ path: string; status: "written" | "skipped" | "failed"; detail?: string }>;
export type CommandView = Pick<
  CliView,
  | "answer"
  | "help"
  | "config"
  | "indexBuilt"
  | "ragAnswer"
  | "infoAnswer"
  | "review"
  | "support"
  | "filesResult"
  | "filesApplied"
  | "filesNotApplied"
>;

const fallbackWidth = 88;
const columnGap = "  ";

type Row = Readonly<{ label: string; plain: string; text: string; note?: string | undefined }>;

export class CliView {
  readonly #output: Writable;
  readonly #error: Writable;
  readonly #paint: Paint;

  constructor(output: Writable, error: Writable) {
    this.#output = output;
    this.#error = error;
    this.#paint = painter(output);
  }

  answer(text: string, model: string): void {
    this.#block(`Ответ агента · ${model}`, [text]);
  }

  /** Ответ с RAG: текст модели и под ним фрагменты, переданные модели; пустой список — контекст без фрагментов. `model` — подпись `провайдер · модель` для заголовка. */
  ragAnswer(text: string, fragments: readonly string[], model: string): void {
    this.#ragBlock(`Ответ агента · RAG · ${model}`, text, fragments, []);
  }

  /** Ответ `info <вопрос>`: ответ мог дать инструмент проекта, поэтому пустой список фрагментов не показывается. */
  infoAnswer(text: string, fragments: readonly string[], model: string): void {
    const listed =
      fragments.length > 0 ? ["", this.#paint("key", "Фрагменты:"), ...fragments.map((line) => `  ${line}`)] : [];
    this.#block(`Ответ ассистента проекта · ${model}`, [text, ...listed]);
  }

  /** Markdown ревью печатается как есть: тот же текст уходит в файл и комментарий PR. */
  review(markdown: string, model: string): void {
    this.#block(`AI-ревью · ${model}`, [markdown]);
  }

  /** Markdown ответа поддержки печатается как есть: его готовит фича support. */
  support(markdown: string, model: string): void {
    this.#block(`Ответ поддержки · ${model}`, [markdown]);
  }

  /** Markdown ответа ассистента файлов с diff печатается как есть: его готовит фича files. */
  filesResult(markdown: string, model: string): void {
    this.#block(`Ассистент файлов · ${model}`, [markdown]);
  }

  /** Одна служебная строка на каждый вызов `propose_edit`, как `mcpToolStatus`. */
  editProposal(path: string, accepted: boolean): void {
    const outcome = accepted ? "принята" : "отклонена";
    this.#output.write(`${this.#paint("muted", `Правка: ${path} — ${outcome}`)}\n`);
  }

  /** Вопрос без перевода строки: ответ вводится в той же строке. */
  confirmPrompt(question: string): void {
    this.#output.write(`\n${this.#paint("key", question)} [y/N] `);
  }

  filesNotApplied(reason: "declined" | "unavailable"): void {
    const text =
      reason === "declined"
        ? "Изменения не применены."
        : "Изменения не применены: подтверждение возможно только в интерактивном терминале.";
    this.#block("Запись файлов", [text]);
  }

  filesApplied(outcomes: readonly FileOutcome[]): void {
    const labels = { written: "Записано", skipped: "Пропущено", failed: "Ошибка" } as const;
    this.#block(
      "Запись файлов",
      outcomes.map((item) => `${labels[item.status]}: ${item.path}${item.detail ? ` — ${item.detail}` : ""}`),
    );
  }

  help(commands: readonly Command[], settings: readonly HelpSetting[]): void {
    const paint = this.#paint;
    const commandRows = commands.map((command) => ({
      label: [paint("key", command.name), ...command.arguments].join(" "),
      plain: [command.name, ...command.arguments].join(" "),
      text: command.description,
      note: command.aliases?.length ? `Алиасы: ${command.aliases.join(", ")}.` : undefined,
    }));
    const settingRows = settings.map((setting) => ({
      label: `${paint("key", setting.flag)} ${paint("muted", `<${setting.type}>`)}`,
      plain: `${setting.flag} <${setting.type}>`,
      text: setting.description,
    }));
    this.#block("Справка", [
      paint("key", "Команды"),
      ...this.#table(commandRows),
      "",
      paint("key", "Настройки"),
      ...this.#table(settingRows),
    ]);
  }

  config(rows: readonly ConfigRow[]): void {
    const paint = this.#paint;
    const keyWidth = Math.max(...rows.map((row) => row.key.length));
    const valueWidth = Math.max(...rows.map((row) => row.value.length));
    this.#block(
      "Настройки",
      rows.map((row) => {
        const key = paint("key", row.key) + " ".repeat(keyWidth - row.key.length);
        const value = row.value.padEnd(valueWidth);
        return `${key}${columnGap}${value}${columnGap}${paint("muted", `(${row.source})`)}`;
      }),
    );
  }

  /** Итог `rag index`: по строке на стратегию и путь к сохранённому индексу. */
  indexBuilt(lines: readonly string[], path: string): void {
    this.#block("Индекс", [...lines, "", this.#paint("muted", `Сохранено: ${path}`)]);
  }

  /** Одна служебная строка перед финальным ответом; аргументы и содержимое результата не печатаются. */
  mcpToolStatus(serverName: string, toolName: string, succeeded: boolean): void {
    const outcome = succeeded ? "выполнено" : "ошибка";
    this.#output.write(`${this.#paint("muted", `MCP: ${serverName} › ${toolName} — ${outcome}`)}
`);
  }

  /** Служебная строка хода длинной операции; пишется в stderr, чтобы не смешиваться с результатом. */
  progress(text: string): void {
    this.#error.write(`${painter(this.#error)("muted", text)}\n`);
  }

  /** Предупреждение, не прерывающее работу: пишется в stderr. */
  warning(text: string): void {
    const paint = painter(this.#error);
    this.#error.write(`${paint("errorLabel", "Предупреждение")}${paint("error", ` · ${text}`)}\n`);
  }

  error(error: unknown): void {
    const paint = painter(this.#error);
    this.#error.write(`${paint("errorLabel", "Ошибка")}${paint("error", ` · ${describeError(error)}`)}\n`);
  }

  banner(commands: readonly Command[], model: string): void {
    const hint = `Команды: ${commands.map((command) => `/${command.name}`).join(" · ")}. Строка без / — вопрос агенту.`;
    const heading = this.#paint("heading", "── devflow-lab ──");
    this.#output.write(`${heading}\n${this.#paint("muted", `Модель: ${model}`)}\n${this.#paint("muted", hint)}\n`);
  }

  prompt(): void {
    this.#output.write(`\n${this.#paint("prompt", "devflow-lab >")} `);
  }

  #width(): number {
    const columns = (this.#output as Partial<Record<"columns", unknown>>).columns;
    return typeof columns === "number" && columns > 0 ? columns : fallbackWidth;
  }

  #table(rows: readonly Row[]): string[] {
    const labelWidth = Math.max(...rows.map((row) => row.plain.length));
    const indent = " ".repeat(2 + labelWidth + columnGap.length);
    const textWidth = Math.max(this.#width() - indent.length, 20);
    return rows.flatMap((row) => {
      const [first = "", ...rest] = wrapText(row.text, textWidth);
      const label = `  ${row.label}${" ".repeat(labelWidth - row.plain.length)}`;
      const notes = row.note ? wrapText(row.note, textWidth).map((line) => this.#paint("muted", line)) : [];
      return [`${label}${columnGap}${first}`, ...[...rest, ...notes].map((line) => `${indent}${line}`)];
    });
  }

  #ragBlock(title: string, text: string, fragments: readonly string[], footer: readonly string[]): void {
    const label = this.#paint("key", "Фрагменты:");
    const listed = fragments.length > 0 ? [label, ...fragments.map((line) => `  ${line}`)] : [`${label} контекст пуст`];
    this.#block(title, [text, "", ...listed, ...footer]);
  }

  /** Блок начинается с пустой строки, чтобы в REPL отделяться от введённой реплики. */
  #block(title: string, lines: readonly string[]): void {
    const body = lines.join("\n");
    this.#output.write(`\n${this.#paint("heading", `── ${title} ──`)}\n\n${body.endsWith("\n") ? body : `${body}\n`}`);
  }
}
