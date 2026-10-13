import { describe, expect, it } from "vitest";
import { structureRanges } from "../chunking/structure.ts";
import { documentOf, PARAMS } from "./support.ts";

const rangesOf = (text: string) => {
  const document = documentOf(text);
  return { document, ranges: structureRanges(document.blocks, PARAMS) };
};
const list = (items: number) => Array.from({ length: items }, () => `- ${"x".repeat(20)}`).join("\n");

describe("структурный чанкинг", () => {
  it("не разрезает таблицу и код, пока они помещаются в лимит", () => {
    const table = "| h1 | h2 |\n| -- | -- |\n| 1 | 2 |";
    const { document, ranges } = rangesOf(`# T\n\n${"a".repeat(60)}\n\n${table}\n\n\`\`\`js\nconst x = 1;\n\`\`\``);
    expect(ranges.length).toBeGreaterThan(1);
    for (const block of document.blocks) {
      expect(ranges.some((range) => range.start <= block.start && block.end <= range.end)).toBe(true);
    }
  });

  it("объединяет короткие разделы в один чанк", () => {
    const text = "# T\n\n## A\n\nкоротко\n\n## B\n\nещё коротко";
    const { document, ranges } = rangesOf(text);
    expect(ranges).toEqual([{ start: 0, end: document.content.length }]);
  });

  it("закрывает чанк перед заголовком, если он не короче минимума, даже когда всё помещается в лимит", () => {
    const text = `# T\n\n${"a".repeat(45)}\n\n## B\n\n${"b".repeat(40)}`;
    const { document, ranges } = rangesOf(text);
    expect(document.content.length).toBeLessThanOrEqual(PARAMS.chunkSizeChars);
    expect(ranges).toHaveLength(2);
    expect(document.content.slice(ranges[1]?.start ?? 0, ranges[1]?.end)).toMatch(/^## B/);
  });

  it("перекрытие состоит из целых блоков и не длиннее overlapChars", () => {
    const paragraphs = Array.from({ length: 10 }, () => "p".repeat(15)).join("\n\n");
    const { document, ranges } = rangesOf(`# T\n\n${paragraphs}`);
    expect(ranges.length).toBeGreaterThan(1);
    const first = ranges[0];
    const second = ranges[1];
    const lastOfFirst = document.blocks.filter((block) => block.end <= (first?.end ?? 0)).at(-1);
    expect(second?.start).toBe(lastOfFirst?.start);
    expect((first?.end ?? 0) - (second?.start ?? 0)).toBeLessThanOrEqual(PARAMS.overlapChars);
  });

  it("заголовок не остаётся последним блоком чанка", () => {
    const { document, ranges } = rangesOf(`# T\n\n${"s".repeat(30)}\n\n## H\n\n${"z".repeat(80)}`);
    const texts = ranges.map((range) => document.content.slice(range.start, range.end));
    expect(texts).toHaveLength(2);
    expect(texts[0]).not.toContain("## H");
    expect(texts[1]).toMatch(/^## H\n\nz{80}$/);
  });

  it("блок длиннее лимита делится окнами; короткое начало раздела входит в первое окно", () => {
    const { document, ranges } = rangesOf(`# T\n\n## Шаги\n\n${list(12)}`);
    expect(ranges[0]?.start).toBe(0);
    expect(ranges.at(-1)?.end).toBe(document.content.length);
    for (const range of ranges) expect(range.end - range.start).toBeLessThanOrEqual(PARAMS.chunkSizeChars);
    expect(ranges.map((range) => document.content.slice(range.start, range.end))).not.toContain("## Шаги");
  });

  it("длинное предыдущее содержимое закрывается отдельно, заголовок делимого блока начинает окно", () => {
    const { document, ranges } = rangesOf(`# T\n\n${"a".repeat(60)}\n\n## Шаги\n\n${list(12)}`);
    expect(document.content.slice(ranges[0]?.start, ranges[0]?.end)).toBe(`# T\n\n${"a".repeat(60)}`);
    expect(document.content.slice(ranges[1]?.start, ranges[1]?.end)).toMatch(/^## Шаги/);
  });

  it("короткий хвост присоединяется к предыдущему чанку, если вместе они помещаются", () => {
    const fits = rangesOf(`# T\n\n${"a".repeat(50)}\n\n## Links\n\n- x`);
    expect(fits.ranges).toEqual([{ start: 0, end: fits.document.content.length }]);
    const overflows = rangesOf(`# T\n\n${"a".repeat(95)}\n\n## Links\n\n- x`);
    expect(overflows.ranges).toHaveLength(2);
  });

  it("покрывает каждую позицию каждого блока", () => {
    const table = "| h1 | h2 |\n| -- | -- |\n| 1 | 2 |";
    const { document, ranges } = rangesOf(
      `# T\n\nintro\n\n## A\n\n${"a".repeat(70)}\n\n## B\n\n${list(12)}\n\n${table}\n\n## C\n\n- z`,
    );
    const covered = new Uint8Array(document.content.length);
    for (const range of ranges) covered.fill(1, range.start, range.end);
    for (const block of document.blocks) expect(covered.slice(block.start, block.end).every(Boolean)).toBe(true);
  });
});
