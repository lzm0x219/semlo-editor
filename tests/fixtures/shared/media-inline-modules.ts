import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

/** 将测试依赖按顺序拼成一个浏览器模块，保留生产代码中的同一份实现。 */
export function inlineMediaModules(paths: string[]): string {
  return paths
    .map((path) =>
      stripTypeScriptTypes(readFileSync(path, "utf8")).replace(
        /^import\s+(?:[\s\S]*?\s+from\s+)?["'][^"']+["'];?[ \t]*\n/gm,
        "",
      ),
    )
    .join("\n");
}
