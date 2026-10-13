import { describe, expect, it } from "vitest";
import { buildChunks, chunkId } from "../chunking/build.ts";
import { STRATEGIES } from "../types.ts";
import { documentOf, PARAMS } from "./support.ts";

const TEXT = `# Заголовок 😀\n\nНачало.\n\n## Раздел\n\n${"слово ".repeat(40)}\n\n\`\`\`js\nconst x = "😀";\n\`\`\`\n\n## Конец\n\nВсё.`;

describe("сборка чанков", () => {
  it.each(STRATEGIES)("%s: текст чанка — точный срез документа по диапазону, документ покрыт", (strategy) => {
    const document = documentOf(TEXT);
    const chunks = buildChunks(document, strategy, PARAMS);
    expect(chunks.length).toBeGreaterThan(1);
    const covered = new Uint8Array(document.content.length);
    for (const chunk of chunks) {
      expect(chunk.text).toBe(document.content.slice(chunk.start, chunk.end));
      covered.fill(1, chunk.start, chunk.end);
    }
    for (const block of document.blocks) expect(covered.slice(block.start, block.end).every(Boolean)).toBe(true);
  });

  it("проставляет метаданные и полные пути заголовков", () => {
    const document = documentOf(TEXT, "guides/sample.md", "Название");
    const chunk = buildChunks(document, "structure", PARAMS)[0];
    expect(chunk).toMatchObject({
      strategy: "structure",
      file: "guides/sample.md",
      source: "src/guides/sample.md",
      title: "Название",
    });
    expect(chunk?.sections[0]).toBe("Заголовок 😀");
    expect(chunk?.sections).toContain("Заголовок 😀 › Раздел");
  });

  it("блоки до первого заголовка подписываются названием документа", () => {
    const chunk = buildChunks(documentOf("вступление\n\n# Потом", "a.md", "Название"), "fixed", PARAMS)[0];
    expect(chunk?.sections).toEqual(["Название", "Потом"]);
  });

  it("chunk_id читаемый, детерминированный и уникальный в документе", () => {
    const document = documentOf(TEXT, "guides/sample.md");
    const ids = buildChunks(document, "fixed", PARAMS).map((chunk) => chunk.chunk_id);
    expect(ids).toEqual(
      buildChunks(documentOf(TEXT, "guides/sample.md"), "fixed", PARAMS).map((chunk) => chunk.chunk_id),
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toMatch(/^fixed:guides\/sample\.md#000-[0-9a-f]{8}$/);
    expect(ids[1]).toMatch(/#001-/);
  });

  it("параметры и содержимое влияют на ID; лишний для стратегии параметр — нет", () => {
    const document = documentOf(TEXT);
    const range = { start: 0, end: 50 };
    const id = (params = PARAMS, strategy: "fixed" | "structure" = "fixed", doc = document) =>
      chunkId(doc, strategy, params, 0, range);
    expect(id({ ...PARAMS, chunkSizeChars: 101 })).not.toBe(id());
    expect(id({ ...PARAMS, minChunkChars: 41 })).toBe(id());
    expect(id({ ...PARAMS, minChunkChars: 41 }, "structure")).not.toBe(id(PARAMS, "structure"));
    expect(id(PARAMS, "fixed", documentOf(`${TEXT}!`))).not.toBe(id());
  });

  it("пропускает окна из одних пробелов и нумерует оставшиеся подряд", () => {
    const document = documentOf(`начало\n\n${" ".repeat(300)}\n\nконец`);
    const chunks = buildChunks(document, "fixed", PARAMS);
    expect(chunks.every((chunk) => chunk.text.trim() !== "")).toBe(true);
    expect(chunks.map((chunk) => chunk.chunk_id.split("#")[1]?.slice(0, 3))).toEqual(
      chunks.map((_, index) => String(index).padStart(3, "0")),
    );
  });
});
