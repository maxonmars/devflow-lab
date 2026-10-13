import { existsSync, globSync, lstatSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parse } from "yaml";
import { RagError } from "./errors.ts";
import { parseBlocks } from "./markdown.ts";
import { CodePointText, sha256 } from "./text.ts";
import type { Block } from "./types.ts";

export type LoadedDocument = Readonly<{
  file: string;
  source: string;
  title: string;
  hash: string;
  content: CodePointText;
  blocks: readonly Block[];
}>;

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n\n?/;

function normalize(raw: string): string {
  return raw.replace(/^﻿/, "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function splitFrontmatter(file: string, text: string): { meta: Record<string, unknown>; body: string } {
  const match = FRONTMATTER.exec(text);
  if (!match) return { meta: {}, body: text };
  let meta: unknown;
  try {
    meta = parse(match[1] ?? "");
  } catch {
    throw new RagError("INVALID_FRONTMATTER", { file });
  }
  if (meta !== null && (typeof meta !== "object" || Array.isArray(meta))) {
    throw new RagError("INVALID_FRONTMATTER", { file });
  }
  return { meta: (meta ?? {}) as Record<string, unknown>, body: text.slice(match[0].length) };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const SKIPPED_DIRS = /(^|\/)(node_modules|\.git|dist|coverage|\.local)(\/|$)/;

function markdownFiles(root: string, include: readonly string[]): string[] {
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new RagError("CORPUS_NOT_FOUND");
  const matched = globSync([...include], { cwd: root, exclude: (path) => SKIPPED_DIRS.test(path) })
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => path.endsWith(".md") && lstatSync(join(root, path)).isFile());
  return [...new Set(matched)].sort();
}

/**
 * Читает `.md` по шаблонам `include` внутри `root` в стабильном порядке; символические ссылки пропускаются.
 * Frontmatter необязателен: без него `source` — относительный путь, `title` — первый H1 или имя файла.
 */
export function loadCorpus(root: string, include: readonly string[]): LoadedDocument[] {
  const documents: LoadedDocument[] = [];
  for (const file of markdownFiles(root, include)) {
    const { meta, body } = splitFrontmatter(file, normalize(readFileSync(join(root, file), "utf8")));
    if (!body.trim()) continue;
    const content = new CodePointText(body);
    const { blocks, firstHeading } = parseBlocks(content);
    documents.push({
      file,
      source: text(meta.source) ?? file,
      title: text(meta.title) ?? firstHeading ?? basename(file, ".md"),
      hash: sha256(body),
      content,
      blocks,
    });
  }
  if (documents.length === 0) throw new RagError("EMPTY_CORPUS");
  return documents;
}
