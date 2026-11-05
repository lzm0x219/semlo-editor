import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** 按产品样式清单的顺序读取，供需要内联样式的浏览器测试使用。 */
export function readEditorStyles(): string {
  const directory = resolve("packages/core/src/styles");
  const manifest = readFileSync(resolve(directory, "style.css"), "utf8");
  return manifest
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const match = /^@import "([^"]+)";$/.exec(line);
      if (!match) throw new Error(`无效的编辑器样式清单：${line}`);
      return readFileSync(resolve(directory, match[1]), "utf8");
    })
    .join("\n");
}
