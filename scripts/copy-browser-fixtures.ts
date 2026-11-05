import { copyFile, cp, mkdir } from "node:fs/promises";

await mkdir(".browser-test/tests", { recursive: true });
await cp("packages/core/dist/fonts", ".browser-test/dist/fonts", { recursive: true });
// 保持测试服务器中的访问路径不变，即使 fixture 源文件已按用途归类。
for (const name of [
  "controlled.html",
  "sample-image.svg",
  "sample-attachment.txt",
  "sample-video.mp4",
  "sample-audio.wav",
]) {
  await copyFile(`tests/fixtures/assets/${name}`, `.browser-test/tests/${name}`);
}
