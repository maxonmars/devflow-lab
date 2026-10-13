import type { Nodes, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type { CodePointText } from "./text.ts";
import type { Block, BlockType } from "./types.ts";

const SECTION_SEPARATOR = " › ";

export type ParsedMarkdown = Readonly<{ blocks: readonly Block[]; firstHeading: string | undefined }>;

function plainText(node: Nodes): string {
  if ("children" in node) return node.children.map(plainText).join("");
  return "value" in node && typeof node.value === "string" ? node.value : "";
}

function blockType(node: RootContent): BlockType {
  switch (node.type) {
    case "heading":
    case "paragraph":
    case "code":
    case "table":
    case "list":
    case "blockquote":
    case "html":
      return node.type;
    default:
      return "other";
  }
}

/** Блоки верхнего уровня с путём заголовков; заголовки внутри fenced-кода mdast не считает заголовками. */
export function parseBlocks(content: CodePointText): ParsedMarkdown {
  const tree = fromMarkdown(content.text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const path: { depth: number; title: string }[] = [];
  const blocks: Block[] = [];
  let firstHeading: string | undefined;
  for (const node of tree.children) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    if (node.type === "heading") {
      const title = plainText(node).replaceAll(/\s+/g, " ").trim();
      while (path.length > 0 && (path.at(-1)?.depth ?? 0) >= node.depth) path.pop();
      path.push({ depth: node.depth, title });
      if (node.depth === 1) firstHeading ??= title;
    }
    blocks.push({
      type: blockType(node),
      start: content.fromUtf16(start),
      end: content.fromUtf16(end),
      section: path.map((item) => item.title).join(SECTION_SEPARATOR),
    });
  }
  return { blocks, firstHeading };
}
