import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const stylesDirectory = new URL("../src/styles/", import.meta.url);
const packageDirectory = new URL("../", import.meta.url);
const outputDirectory = resolve(process.argv[2] ?? fileURLToPath(new URL("../dist/", import.meta.url)));

async function readManifest(name: string) {
  const manifest = await readFile(new URL(name, stylesDirectory), "utf8");
  return manifest
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const match = /^@import "([^"]+)";$/.exec(line);
      if (!match) throw new Error(`Invalid editor style manifest: ${line}`);
      return match[1];
    });
}

const files: URL[] = [];
for (const entry of await readManifest("bundle.css")) {
  if (entry === "./style.css") {
    for (const nested of await readManifest("style.css")) files.push(new URL(nested, stylesDirectory));
  } else files.push(new URL(entry, stylesDirectory));
}
const styles = await Promise.all(files.map((file) => readFile(file, "utf8")));
await mkdir(outputDirectory, { recursive: true });
await writeFile(
  resolve(outputDirectory, "style.css"),
  styles.join("\n").replaceAll("../../node_modules/katex/dist/fonts/", "fonts/"),
);
await cp(new URL("node_modules/katex/dist/fonts", packageDirectory), resolve(outputDirectory, "fonts"), {
  recursive: true,
});
await copyFile(new URL("licenses/KATEX-LICENSE.txt", packageDirectory), resolve(outputDirectory, "KATEX-LICENSE.txt"));
await copyFile(
  new URL("node_modules/lunar-typescript/LICENSE", packageDirectory),
  resolve(outputDirectory, "LUNAR-TYPESCRIPT-LICENSE.txt"),
);
await copyFile(
  new URL("licenses/MATERIAL-ICONS-LICENSE.txt", packageDirectory),
  resolve(outputDirectory, "MATERIAL-ICONS-LICENSE.txt"),
);
