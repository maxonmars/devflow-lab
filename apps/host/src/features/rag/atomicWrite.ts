import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { RagError } from "./errors.ts";

/** Временный файл рядом и `rename`: при ошибке прежний файл остаётся целым. */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temporary, content, "utf8");
    await rename(temporary, path);
  } catch {
    // rm с force игнорирует только ENOENT; ENOTDIR при недоступном каталоге он пробрасывает.
    await rm(temporary, { force: true }).catch(() => {});
    throw new RagError("INDEX_WRITE_FAILED");
  }
}
