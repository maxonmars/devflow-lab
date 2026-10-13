import { describe, expect, it, vi } from "vitest";
import type { ModelCompletion, ModelPort, ModelRequest, ToolSource } from "../../../core/index.ts";
import { answerWithRag } from "../answer.ts";
import { renderCitedAnswer } from "../citationRender.ts";
import { parseCitedAnswer } from "../citations.ts";
import { generateWithTools } from "../projectAnswer.ts";
import { readPrompt } from "../prompts.ts";
import { fakeSearchIndex, searchHit } from "./support.ts";

const HIT = searchHit(1, "README.md", 0.8, "Серверы MCP лежат в каталоге servers и только читают проект.");
const QUOTE = "Серверы MCP лежат в каталоге servers";

function gitTools() {
  const callTool = vi.fn(async () => ({ content: "Ветка: main", isError: false }));
  const source: ToolSource = {
    listTools: async () => [
      { name: "git_branch", inputSchema: { type: "object" } },
      { name: "git_diff", inputSchema: { type: "object" } },
    ],
    callTool,
  };
  return { source, callTool };
}

/** Первый ответ — вызов `tool` (если задан), затем текст `final`. */
function scriptedModel(final: string, tool?: string) {
  const requests: ModelRequest[] = [];
  const model: ModelPort = {
    async complete(request): Promise<ModelCompletion> {
      requests.push(request);
      if (tool && !request.messages.some((message) => message.role === "tool")) {
        return { type: "tool_calls", calls: [{ id: "c1", name: tool, arguments: {} }] };
      }
      return { type: "text", content: final };
    },
  };
  return { model, requests };
}

const ANSWER_WITH_DATA = [
  "## Ответ",
  "Сейчас ветка main, серверы лежат в servers [1].",
  "## Источники",
  "- [1]",
  "## Цитаты",
  `- [1] «${QUOTE}»`,
  "## Данные проекта",
  "- git_branch: ветка main",
].join("\n");

describe("ответ с инструментами проекта", () => {
  it("модель получает project.md, фрагменты и инструменты; факт вызванного инструмента принимается", async () => {
    const { source, callTool } = gitTools();
    const { model, requests } = scriptedModel(ANSWER_WITH_DATA, "git_branch");
    const { answer } = await generateWithTools({
      model,
      systemPrompt: "Системная инструкция.",
      question: "Какая ветка и где серверы?",
      hits: [HIT],
      tools: { source, maxToolCalls: 2 },
    });
    expect(requests[0]?.messages[0]).toEqual({
      role: "system",
      content: `Системная инструкция.\n\n${readPrompt("project.md")}`,
    });
    expect(requests[0]?.tools.map((tool) => tool.name)).toEqual(["git_branch", "git_diff"]);
    expect(String(requests[0]?.messages[1]?.content)).toContain("### Фрагмент 1");
    expect(callTool).toHaveBeenCalledOnce();
    expect(answer).toMatchObject({
      kind: "answer",
      projectData: [{ tool: "git_branch", text: "ветка main", called: true }],
      problems: [],
    });
    expect(renderCitedAnswer(answer)).toContain("Данные проекта:\n- git_branch: ветка main");
  });

  it("пустой отбор не отменяет вызов модели; ответ только по инструменту не требует цитат", async () => {
    const { source } = gitTools();
    const { model, requests } = scriptedModel(
      "## Ответ\nВетка main.\n## Данные проекта\n- git_branch: main",
      "git_branch",
    );
    const { index } = fakeSearchIndex(() => []);
    const result = await answerWithRag({
      question: "Какая ветка?",
      index,
      mode: "filter",
      candidateTopK: 5,
      topK: 3,
      threshold: 0.5,
      model,
      systemPrompt: "Система.",
      answerPrompt: "default",
      tools: { source, maxToolCalls: 2 },
    });
    expect(String(requests[0]?.messages[1]?.content)).toContain("Подходящих фрагментов нет.");
    expect(result.hits).toEqual([]);
    expect(result.answer).toMatchObject({ kind: "answer", problems: [] });
  });

  it("факт инструмента, который не вызывался, — замечание", async () => {
    const { source } = gitTools();
    const { model } = scriptedModel("## Ответ\nИзменений нет.\n## Данные проекта\n- git_diff: изменений нет");
    const { answer } = await generateWithTools({
      model,
      systemPrompt: "Система.",
      question: "Что изменено?",
      hits: [],
      tools: { source, maxToolCalls: 2 },
    });
    expect(answer).toMatchObject({ problems: [{ code: "tool-not-called", tool: "git_diff" }] });
    expect(renderCitedAnswer(answer)).toContain("- git_diff: изменений нет — инструмент не вызывался");
    expect(renderCitedAnswer(answer)).toContain("инструмент git_diff в этом ответе не вызывался");
  });

  it("без инструментов раздел «Данные проекта» остаётся лишним, как в rag ask", () => {
    const raw = `${ANSWER_WITH_DATA.split("## Данные проекта")[0]}## Данные проекта\n- git_branch: main`;
    const answer = parseCitedAnswer(raw, [HIT]);
    expect(answer).toMatchObject({
      projectData: [],
      problems: [{ code: "unexpected-section", heading: "Данные проекта" }],
    });
  });
});
