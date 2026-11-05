import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, test } from "@rstest/core";

const execFileAsync = promisify(execFile);
const checkDirectory = resolve("tests/browser/checks");
const checkNames = (await readdir(checkDirectory)).filter((name) => name.endsWith("-check.ts")).sort();
if (!checkNames.length) throw new Error("没有发现独立浏览器检查脚本");

let outputDirectory: string | undefined;
let environment: NodeJS.ProcessEnv;

beforeAll(async () => {
  // 单独构建检查所需的资源，避免覆盖开发或其他测试的构建产物。
  outputDirectory = await mkdtemp(join(tmpdir(), "semlo-editor-browser-checks-"));
  const mindmapDirectory = join(outputDirectory, "mindmap");
  const canvasDirectory = join(outputDirectory, "canvas-editor");
  await Promise.all([mkdir(mindmapDirectory), mkdir(canvasDirectory)]);
  environment = {
    ...process.env,
    MINDMAP_TEST_DIR: mindmapDirectory,
    CANVAS_EDITOR_TEST_DIR: canvasDirectory,
  };
  const rsbuild = resolve("tests/node_modules/@rsbuild/core/bin/rsbuild.js");
  for (const config of ["mindmap-rsbuild.config.ts", "canvas-editor-rsbuild.config.ts"]) {
    await execFileAsync(process.execPath, [rsbuild, "build", "--config", `tests/config/${config}`], {
      cwd: process.cwd(),
      env: environment,
      maxBuffer: 10 * 1024 * 1024,
    });
  }
});

afterAll(async () => {
  if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true });
});

for (const name of checkNames) {
  test(name, async () => {
    await execFileAsync(process.execPath, [join(checkDirectory, name)], {
      cwd: process.cwd(),
      env: environment,
      maxBuffer: 10 * 1024 * 1024,
    });
  });
}
