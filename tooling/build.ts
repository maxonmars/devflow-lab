import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { files, localPath, workspacePaths } from "./files.ts";

const root = resolve(".");
for (const workspace of workspacePaths(root)) {
  rmSync(join(workspace, "dist"), { recursive: true, force: true });
  execFileSync(
    process.execPath,
    [join(root, "node_modules/typescript/bin/tsc"), "-p", join(workspace, "tsconfig.build.json")],
    { stdio: "inherit" },
  );
  for (const path of files(join(workspace, "src")).filter((path) => path.endsWith(".md"))) {
    const target = join(workspace, "dist", localPath(join(workspace, "src"), path));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(path, target);
  }
}

const temporary = mkdtempSync(join(tmpdir(), "devflow-lab-build-"));
try {
  const main = join(root, "apps/host/dist/app/main.js");
  const help = execFileSync(process.execPath, [main, "help"], {
    cwd: temporary,
    encoding: "utf8",
    env: {},
    stdio: "pipe",
  });
  for (const name of ["rag index", "rag ask", "config show"]) {
    if (!help.includes(name)) throw new Error(`В собранной справке отсутствует ${name}.`);
  }
  execFileSync(process.execPath, [main, "config", "show"], { cwd: temporary, env: {}, stdio: "pipe" });
  console.log("Сборка и запуск CLI из другого каталога: OK.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
