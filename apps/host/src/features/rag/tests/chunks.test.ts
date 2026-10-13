import { describe, expect, it } from "vitest";
import { buildChunks, chunkId } from "../chunking/build.ts";
import { documentOf, PARAMS } from "./support.ts";

const TEXT = `# Заголовок 😀\n\nНачало.\n\n## Раздел\n\n${"слово ".repeat(40)}\n\n\`\`\`js\nconst x = "😀";\n\`\`\`\n\n## Конец\n\nВсё.`;

describe("сборка чанков", () => {
  it("текст чанка — точный срез документа по диапазону, все блоки покрыты", () => {
    const document = documentOf(TEXT);
    const chunks = buildChunks(document, PARAMS);
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
    const chunk = buildChunks(document, PARAMS)[0];
    expect(chunk).toMatchObject({
      file: "guides/sample.md",
      source: "src/guides/sample.md",
      title: "Название",
    });
    expect(chunk?.sections[0]).toBe("Заголовок 😀");
    expect(chunk?.sections).toContain("Заголовок 😀 › Раздел");
  });

  it("блоки до первого заголовка подписываются названием документа", () => {
    const chunk = buildChunks(documentOf("вступление\n\n# Потом", "a.md", "Название"), PARAMS)[0];
    expect(chunk?.sections).toEqual(["Название", "Потом"]);
  });

  it("chunk_id читаемый, детерминированный и уникальный в документе", () => {
    const document = documentOf(TEXT, "guides/sample.md");
    const ids = buildChunks(document, PARAMS).map((chunk) => chunk.chunk_id);
    expect(ids).toEqual(buildChunks(documentOf(TEXT, "guides/sample.md"), PARAMS).map((chunk) => chunk.chunk_id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toMatch(/^guides\/sample\.md#000-[0-9a-f]{8}$/);
    expect(ids[1]).toMatch(/#001-/);
  });

  it("каждый параметр чанкинга и содержимое документа влияют на ID", () => {
    const document = documentOf(TEXT);
    const range = { start: 0, end: 50 };
    const id = (params = PARAMS, doc = document) => chunkId(doc, params, 0, range);
    expect(id({ ...PARAMS, chunkSizeChars: 101 })).not.toBe(id());
    expect(id({ ...PARAMS, overlapChars: 11 })).not.toBe(id());
    expect(id({ ...PARAMS, minChunkChars: 41 })).not.toBe(id());
    expect(id(PARAMS, documentOf(`${TEXT}!`))).not.toBe(id());
  });

  it("не создаёт пустых чанков и нумерует чанки подряд", () => {
    const chunks = buildChunks(documentOf(TEXT), PARAMS);
    expect(chunks.every((chunk) => chunk.text.trim() !== "")).toBe(true);
    expect(chunks.map((chunk) => chunk.chunk_id.split("#")[1]?.slice(0, 3))).toEqual(
      chunks.map((_, index) => String(index).padStart(3, "0")),
    );
  });
});
