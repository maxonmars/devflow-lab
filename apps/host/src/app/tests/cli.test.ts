import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelRequest } from "../../core/index.ts";
import { invoke } from "./harness.ts";

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "devflow-lab-cli-"));
  vi.stubEnv("FORCE_COLOR", undefined);
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("CLI и REPL", () => {
  it("одинаково обрабатывают ask и /ask, реплика уходит модели без инструментов", async () => {
    const cli = await invoke(["ask", "Вопрос с пробелами"], { cwd });
    const repl = await invoke([], { cwd, input: "/ask Вопрос с пробелами\n/exit\n" });
    expect(cli.code).toBe(0);
    expect(repl.output).toBe(cli.output);
    expect(repl.complete.mock.calls).toEqual(cli.complete.mock.calls);
    const request = cli.complete.mock.calls[0]?.[0] as ModelRequest;
    expect(request.messages[0]?.content).toContain("ассистент разработчика проекта");
    expect(request.tools).toEqual([]);
    expect(request.toolChoice).toBe("none");
  });

  it("справка и config show работают без ключа, модели и Ollama", async () => {
    const help = await invoke(["--help"], { cwd, authenticated: false });
    const config = await invoke(["config", "show"], { cwd, authenticated: false });
    expect(help.output).toContain("--rag-chunk-size-chars");
    expect(config.output).toContain("[не задано]");
    for (const result of [help, config]) {
      expect(result.createModel).not.toHaveBeenCalled();
      expect(result.createEmbeddings).not.toHaveBeenCalled();
    }
  });

  it("при отсутствии ключа ask возвращает ошибку и не создаёт модель", async () => {
    const result = await invoke(["ask", "Тест"], { cwd, authenticated: false });
    expect(result.code).toBe(1);
    expect(result.error).toContain("LAB_LLM_API_KEY");
    expect(result.createModel).not.toHaveBeenCalled();
  });

  it("--llm-provider local создаёт локальную модель без ключа", async () => {
    const result = await invoke(["--llm-provider", "local", "ask", "Тест"], { cwd, authenticated: false });
    expect(result.code).toBe(0);
    expect(result.createModel).toHaveBeenCalledWith({
      provider: "local",
      baseUrl: "http://localhost:11434/v1",
      model: "qwen3",
      timeoutMs: 180000,
      maxOutputTokens: 1024,
    });
    expect(result.output).toContain("── Ответ агента · local · qwen3 ──");
  });

  it("LAB_LLM_LOCAL_API_KEY уходит в локальную модель как apiKey", async () => {
    const env = { LAB_LLM_LOCAL_API_KEY: "gateway-key" };
    const result = await invoke(["--llm-provider", "local", "ask", "Тест"], { cwd, authenticated: false, env });
    expect(result.code).toBe(0);
    expect(result.createModel).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "local", apiKey: "gateway-key" }),
    );
  });

  it("--llm-local-model меняет подпись модели в ответе", async () => {
    const argv = ["--llm-provider", "local", "--llm-local-model", "qwen3.8:27b-mlx", "ask", "Тест"];
    const result = await invoke(argv, { cwd, authenticated: false });
    expect(result.code).toBe(0);
    expect(result.output).toContain("── Ответ агента · local · qwen3.8:27b-mlx ──");
  });

  it("LAB_LLM_PROVIDER=deepseek передаёт ключ и модель DeepSeek", async () => {
    const result = await invoke(["ask", "Тест"], { cwd, env: { LAB_LLM_PROVIDER: "deepseek" } });
    expect(result.createModel).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "deepseek", apiKey: "test-key", model: "deepseek-flash" }),
    );
    expect(result.output).toContain("── Ответ агента · deepseek · deepseek-flash ──");
  });

  it("продолжает REPL после неизвестной команды и останавливается на /exit", async () => {
    const result = await invoke([], { cwd, input: "/unknown\nВопрос\n/exit\nПосле выхода\n" });
    expect(result.code).toBe(1);
    expect(result.error).toContain("Неизвестная команда");
    expect(result.output).toBe("\n── Ответ агента · deepseek · deepseek-flash ──\n\nОтвет: Вопрос\n");
    expect(result.complete).toHaveBeenCalledTimes(1);
  });

  it("отклоняет лишние и отсутствующие аргументы команд", async () => {
    expect((await invoke(["help", "extra"], { cwd })).code).toBe(1);
    expect((await invoke(["config", "show", "extra"], { cwd })).code).toBe(1);
    expect((await invoke(["ask"], { cwd })).code).toBe(1);
    expect((await invoke(["rag", "index", "extra"], { cwd })).code).toBe(1);
  });

  it("интерактивный REPL показывает заголовок один раз и приглашение перед каждым вводом", async () => {
    const result = await invoke([], { cwd, input: "Вопрос\n/exit\n", interactive: true });
    expect(result.output.match(/── devflow-lab ──/g)).toHaveLength(1);
    expect(result.output.match(/Модель: deepseek · deepseek-flash/g)).toHaveLength(1);
    expect(result.output).toContain(
      "/ask · /info · /support · /help · /config show · /rag index · /rag ask · /review · /exit",
    );
    expect(result.output.match(/devflow-lab > /g)).toHaveLength(2);
  });

  it("при pipe-вводе не печатает заголовок и приглашение", async () => {
    const result = await invoke([], { cwd, input: "/config show\n/exit\n" });
    expect(result.output).not.toContain("devflow-lab");
    expect(result.output.startsWith("\n── Настройки ──")).toBe(true);
  });

  it("оформляет ошибку разбора аргументов так же, как ошибку команды", async () => {
    const parse = await invoke(["--unknown", "x", "help"], { cwd });
    const command = await invoke(["unknown"], { cwd });
    expect(parse.code).toBe(1);
    expect(parse.output).toBe("");
    expect(parse.error).toBe("Ошибка · Неизвестный или недоступный флаг. Используйте help.\n");
    expect(command.error).toBe("Ошибка · Неизвестная команда. Используйте help.\n");
  });

  it("справка разделена на команды и настройки без секретного флага", async () => {
    const { output } = await invoke(["help"], { cwd });
    expect(output.indexOf("\nКоманды\n")).toBeLessThan(output.indexOf("\nНастройки\n"));
    expect(output).toContain("  ask <текст...>");
    expect(output).toContain("Алиасы: --help, -h.");
    expect(output).toMatch(/--rag-embedding-timeout-ms <number>\s+\S/);
    expect(output).not.toContain("--llm-api-key");
  });

  it("config show не выводит значение ключа", async () => {
    const { output } = await invoke(["config", "show"], { cwd });
    expect(output).toMatch(/llm\.apiKey\s+\[задано\]\s+\(env\)/);
    expect(output).not.toContain("test-key");
  });

  it("цвет не попадает в данные модели", async () => {
    const plain = await invoke([], { cwd, input: "Вопрос\n/config show\n/exit\n" });
    const colored = await invoke([], { cwd, input: "Вопрос\n/config show\n/boom\n", color: true });
    expect(colored.output).toContain("\u001b[");
    expect(colored.error).toContain("\u001b[");
    expect(stripVTControlCharacters(colored.output)).toBe(plain.output);
    expect(colored.complete.mock.calls).toEqual(plain.complete.mock.calls);
  });
});
