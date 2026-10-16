import { Writable } from "node:stream";
import { stripVTControlCharacters } from "node:util";
import { beforeEach, expect, it, vi } from "vitest";
import { AgentError } from "../../../core/index.ts";
import { CliView, type Command } from "../index.ts";

beforeEach(() => {
  vi.stubEnv("FORCE_COLOR", undefined);
  vi.stubEnv("NO_COLOR", undefined);
  vi.stubEnv("NODE_DISABLE_COLORS", undefined);
});

function capture(color = false) {
  const stream = Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        stream.text += chunk.toString();
        done();
      },
    }),
    { text: "" },
  );
  if (color) Object.assign(stream, { isTTY: true, getColorDepth: () => 8 });
  return stream;
}

const model = "local · qwen3";

const commands: Command[] = [
  { name: "ask", arguments: ["<текст...>"], description: "Спросить.", run: async () => "continue" },
  { name: "help", arguments: [], aliases: ["--help", "-h"], description: "Справка.", run: async () => "continue" },
];

function renderAll(view: CliView): void {
  view.banner(commands, model);
  view.prompt();
  view.answer("Ответ модели", model);
  view.help(commands, [{ flag: "--llm-model", type: "string", description: "Модель." }]);
  view.config([{ key: "llm.apiKey", value: "[задано]", source: "env" }]);
  view.indexBuilt(["fixed: 2 чанка"], "/data/index.json");
  view.ragAnswer("Ответ по документам", ["1. a.md › Раздел · 0.71"], model);
  view.mcpToolStatus("git", "git_branch", true);
  view.error(new AgentError("EMPTY_RESPONSE"));
}

it("обычный поток получает текст без ANSI, цветной — ту же структуру со стилями", () => {
  const plain = { output: capture(), error: capture() };
  const colored = { output: capture(true), error: capture(true) };
  renderAll(new CliView(plain.output, plain.error));
  renderAll(new CliView(colored.output, colored.error));
  expect(plain.output.text).not.toContain("\u001b[");
  expect(plain.error.text).toBe("Ошибка · Модель вернула пустой ответ.\n");
  expect(colored.output.text).toContain("\u001b[36m\u001b[1m── Ответ агента · local · qwen3 ──");
  expect(colored.output.text).toContain("\u001b[35mdevflow-lab >\u001b[39m ");
  expect(colored.error.text).toContain("\u001b[31m\u001b[1mОшибка");
  expect(stripVTControlCharacters(colored.output.text)).toBe(plain.output.text);
  expect(stripVTControlCharacters(colored.error.text)).toBe(plain.error.text);
});

it("решает о цвете отдельно для stdout и stderr", () => {
  const output = capture(true);
  const error = capture();
  const view = new CliView(output, error);
  view.answer("Текст", model);
  view.error(new AgentError("EMPTY_INPUT"));
  expect(output.text).toContain("\u001b[");
  expect(error.text).toBe("Ошибка · Введите непустую реплику.\n");
  expect(output.text).not.toContain("Ошибка");
});

it("оформляет справку, настройки и ответ по визуальному контракту", () => {
  const output = capture();
  renderAll(new CliView(output, capture()));
  expect(output.text).toBe(
    [
      "── devflow-lab ──",
      "Модель: local · qwen3",
      "Команды: /ask · /help. Строка без / — вопрос агенту.",
      "",
      "devflow-lab > ",
      "── Ответ агента · local · qwen3 ──",
      "",
      "Ответ модели",
      "",
      "── Справка ──",
      "",
      "Команды",
      "  ask <текст...>  Спросить.",
      "  help            Справка.",
      "                  Алиасы: --help, -h.",
      "",
      "Настройки",
      "  --llm-model <string>  Модель.",
      "",
      "── Настройки ──",
      "",
      "llm.apiKey  [задано]  (env)",
      "",
      "── Индекс ──",
      "",
      "fixed: 2 чанка",
      "",
      "Сохранено: /data/index.json",
      "",
      "── Ответ агента · RAG · local · qwen3 ──",
      "",
      "Ответ по документам",
      "",
      "Фрагменты:",
      "  1. a.md › Раздел · 0.71",
      "MCP: git › git_branch — выполнено",
      "",
    ].join("\n"),
  );
});

it("не показывает текст неизвестной ошибки", () => {
  const error = capture();
  new CliView(capture(), error).error(new Error("sk-secret-value"));
  expect(error.text).toBe("Ошибка · Не удалось выполнить операцию.\n");
});

it("итог и ход операции: итог — в stdout, ход и предупреждение — в stderr", () => {
  const output = capture();
  const error = capture();
  const view = new CliView(output, error);
  view.indexBuilt(["fixed: 1 чанк"], "/data/index.json");
  view.progress("fixed: разбиение, чанков 1");
  view.warning("Что-то пошло не так.");
  expect(output.text).toBe("\n── Индекс ──\n\nfixed: 1 чанк\n\nСохранено: /data/index.json\n");
  expect(error.text).toBe("fixed: разбиение, чанков 1\nПредупреждение · Что-то пошло не так.\n");
});

it("ответ с RAG без фрагментов и неуспешный вызов инструмента MCP", () => {
  const output = capture();
  const view = new CliView(output, capture());
  view.ragAnswer("Ответ", [], model);
  view.mcpToolStatus("git", "git_diff", false);
  expect(output.text).toBe(
    "\n── Ответ агента · RAG · local · qwen3 ──\n\nОтвет\n\nФрагменты: контекст пуст\n" +
      "MCP: git › git_diff — ошибка\n",
  );
});

it("ассистент файлов: ответ, служебные строки правок, вопрос и итог записи", () => {
  const output = capture();
  const view = new CliView(output, capture());
  view.filesResult("Предлагаю правку.", model);
  view.editProposal("README.md", true);
  view.editProposal("README.md", false);
  view.confirmPrompt("Применить изменения к 1 файлам?");
  expect(output.text).toBe(
    "\n── Ассистент файлов · local · qwen3 ──\n\nПредлагаю правку.\n" +
      "Правка: README.md — принята\nПравка: README.md — отклонена\n" +
      "\nПрименить изменения к 1 файлам? [y/N] ",
  );
});

it("итог записи по строке на файл и причины, по которым изменения не применены", () => {
  const output = capture();
  const view = new CliView(output, capture());
  view.filesApplied([
    { path: "a.md", status: "written" },
    { path: "b.md", status: "skipped", detail: "файл изменился после предложения правки" },
    { path: "c.md", status: "failed", detail: "Файл не найден." },
  ]);
  view.filesNotApplied("declined");
  view.filesNotApplied("unavailable");
  expect(output.text).toBe(
    "\n── Запись файлов ──\n\nЗаписано: a.md\nПропущено: b.md — файл изменился после предложения правки\nОшибка: c.md — Файл не найден.\n" +
      "\n── Запись файлов ──\n\nИзменения не применены.\n" +
      "\n── Запись файлов ──\n\nИзменения не применены: подтверждение возможно только в интерактивном терминале.\n",
  );
});
