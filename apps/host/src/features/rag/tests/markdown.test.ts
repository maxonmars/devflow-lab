import { expect, it } from "vitest";
import { parseBlocks } from "../markdown.ts";
import { CodePointText } from "../text.ts";

const parse = (text: string) => {
  const content = new CodePointText(text);
  return { content, ...parseBlocks(content) };
};

it("строит путь заголовков и возвращается на нужный уровень", () => {
  const { blocks } = parse("# A\n\ntext\n\n## B\n\n### C\n\nx\n\n## D\n\ny");
  expect(blocks.filter((block) => block.type === "paragraph").map((block) => block.section)).toEqual([
    "A",
    "A › B › C",
    "A › D",
  ]);
});

it("не считает заголовком строку с # внутри fenced-кода", () => {
  const { blocks, firstHeading } = parse("# Title\n\n```bash\n# comment\n## not heading\n```\n\ntail");
  expect(blocks.map((block) => block.type)).toEqual(["heading", "code", "paragraph"]);
  expect(blocks.at(-1)?.section).toBe("Title");
  expect(firstHeading).toBe("Title");
});

it("различает таблицу GFM, список, цитату, HTML и прочие блоки", () => {
  const text = "| a | b |\n| - | - |\n| 1 | 2 |\n\n- x\n- y\n\n> q\n\n<div>h</div>\n\n---\n\ntext";
  expect(parse(text).blocks.map((block) => block.type)).toEqual([
    "table",
    "list",
    "blockquote",
    "html",
    "other",
    "paragraph",
  ]);
});

it("блоки до первого заголовка получают пустой раздел, firstHeading берёт только H1", () => {
  const { blocks, firstHeading } = parse("intro\n\n## Second\n\n# First");
  expect(blocks[0]?.section).toBe("");
  expect(firstHeading).toBe("First");
});

it("название раздела — простой текст без разметки", () => {
  const { blocks } = parse("# Уровень `app` и **общее**\n\nx");
  expect(blocks[1]?.section).toBe("Уровень app и общее");
});

it("диапазоны блоков считаются в кодовых точках, а не в единицах UTF-16", () => {
  const { blocks, content } = parse("😀 первый\n\n😀 второй");
  expect(blocks.map((block) => content.slice(block.start, block.end))).toEqual(["😀 первый", "😀 второй"]);
  expect(blocks[1]?.start).toBe(10);
});

it("диапазоны блоков не пересекаются и идут по порядку", () => {
  const { blocks } = parse("# T\n\na\n\n```js\nx\n```\n\n- l\n\nb");
  for (const [index, block] of blocks.entries()) {
    expect(block.end).toBeGreaterThan(block.start);
    if (index > 0) expect(block.start).toBeGreaterThanOrEqual(blocks[index - 1]?.end ?? 0);
  }
});
