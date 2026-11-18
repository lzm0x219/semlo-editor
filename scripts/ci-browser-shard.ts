import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";

const rstest = "tests/node_modules/.bin/rstest";
const config = ["--config", "tests/config/rstest.config.ts"];

function listTestFiles(filters: string[] = []): string[] {
  const output = execFileSync(rstest, ["list", ...filters, ...config, "--filesOnly", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const files: { file: string }[] = JSON.parse(output);
  return files.map(({ file }) => relative(process.cwd(), file).split(sep).join("/"));
}

const [indexArg, totalArg, mode] = process.argv.slice(2);
const index = Number(indexArg);
const total = Number(totalArg);
if (!Number.isInteger(index) || !Number.isInteger(total) || index < 1 || index > total) {
  throw new Error("分片编号必须在 1 到分片总数之间。");
}
if (mode !== undefined && mode !== "--list") {
  throw new Error("第三个参数仅支持 --list。");
}

const files = listTestFiles();
if (files.length < total || new Set(files).size !== files.length) {
  throw new Error(`无法将 Rstest 发现的 ${files.length} 个文件唯一分配给 ${total} 个非空分片。`);
}

const history: Record<string, number> = JSON.parse(
  readFileSync(new URL("./ci-browser-timings.json", import.meta.url), "utf8"),
);
const durations = Object.values(history).sort((left, right) => left - right);
if (durations.length === 0 || durations.some((duration) => !Number.isFinite(duration) || duration <= 0)) {
  throw new Error("浏览器测试耗时必须为正数，单位为毫秒。");
}
const fallback = durations[Math.floor(durations.length / 2)];
const rankedFiles = files
  .map((file) => ({ file, duration: history[file] ?? fallback }))
  .sort((left, right) => right.duration - left.duration || left.file.localeCompare(right.file, "en"));

const shards = Array.from({ length: total }, () => ({ files: [] as string[], duration: 0 }));
for (const { file, duration } of rankedFiles) {
  const lightest = shards.reduce((left, right) => (left.duration <= right.duration ? left : right));
  lightest.files.push(file);
  lightest.duration += duration;
}

const shard = shards[index - 1];
// Rstest 将带引号的位置参数视为精确路径。保留引号并核对实际文件清单。
const filters = shard.files.map((file) => `"${file}"`);
const selected = listTestFiles(filters);
const selectedSet = new Set(selected);
if (selected.length !== shard.files.length || shard.files.some((file) => !selectedSet.has(file))) {
  throw new Error(`分片 ${index}/${total} 的 Rstest 文件发现结果与分配清单不一致。`);
}

if (mode === "--list") {
  console.log(JSON.stringify(selected.sort()));
} else {
  console.log(`运行分片 ${index}/${total}（${selected.length} 个文件）`);
  const profileArgs = process.env.PROFILE === "true" ? ["--trace"] : [];
  const result = spawnSync(rstest, ["run", ...filters, ...config, "--pool.maxWorkers", "2", ...profileArgs], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
