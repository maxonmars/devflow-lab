import { randomUUID } from "node:crypto";
import { chmod, rename, rm, stat, writeFile } from "node:fs/promises";
import { FilesError } from "./errors.ts";
import { type FilesContext, resolveVisibleFile } from "./readers.ts";

export const MAX_WRITE_CHARS = 100_000;

/** Замена содержимого существующего видимого файла: временный файл рядом и `rename`, права сохраняются. */
export async function writeVisibleFile(context: FilesContext, path: string, content: string): Promise<void> {
  const target = await resolveVisibleFile(context, path);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, "utf8");
    await chmod(temporary, (await stat(target)).mode & 0o777);
    await rename(temporary, target);
  } catch {
    await rm(temporary, { force: true }).catch(() => {});
    throw new FilesError("WRITE_FAILED");
  }
}
