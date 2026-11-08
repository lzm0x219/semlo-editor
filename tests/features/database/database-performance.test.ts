import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { databaseValueText, type DatabaseData } from "../../../packages/core/src/features/database/model";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/database/performance-fixture";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/database/performance-fixture.ts"));
});
afterAll(async () => stop?.());

test("measure database rendering and cell edits at 100 and 1000 rows", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => !!window.databasePerformanceFixture);
  const samples = await page.evaluate(() =>
    [100, 1000].map((rows) => ({
      size: rows,
      runs: Array.from({ length: 3 }, () => window.databasePerformanceFixture!.measure(rows)),
    })),
  );
  for (const sample of samples) {
    for (const run of sample.runs) {
      expect(run.finalValue).toBe("编辑 7");
      expect(run.elements).toBeGreaterThan(sample.size);
      expect(run.editMs).toHaveLength(8);
    }
  }
  console.log("数据库性能样本", JSON.stringify(samples));
});

// 重负载基准仅在显式启用时执行；每次刷新页面并限制样本数与单次执行时间。
// SEMLO_DATABASE_10000=1 mise exec -- pnpm test:run --disableConsoleIntercept tests/features/database/database-performance.test.ts -t "measure 10000 database rows"
test.skipIf(process.env.SEMLO_DATABASE_10000 !== "1")("measure 10000 database rows", async ({ page }) => {
  const runs = Number(process.env.SEMLO_DATABASE_10000_RUNS ?? "3");
  if (!Number.isInteger(runs) || runs < 1 || runs > 3) throw new Error("SEMLO_DATABASE_10000_RUNS 必须为 1 到 3");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const samples = [];
  for (let index = 0; index < runs; index++) {
    await page.goto(origin);
    await page.waitForFunction(() => !!window.databasePerformanceFixture);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sample = await Promise.race([
      page.evaluate(() => window.databasePerformanceFixture!.measure(10000, true)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("一万行数据表单次测量超过 30 秒")), 30_000);
      }),
    ]).finally(() => clearTimeout(timer));
    expect(sample.rows).toBe(10002);
    expect(sample.elements).toBeGreaterThan(10000);
    expect(sample.finalValue).toBe("编辑 7");
    expect(sample.history).toMatchObject({ undo: true, undoValue: "记录 0", redo: true, redoValue: "编辑 7" });
    samples.push(sample);
    const client = await page.context().newCDPSession(page);
    await client.send("HeapProfiler.collectGarbage");
    await client.detach();
  }
  expect(errors).toEqual([]);
  console.log("一万行数据表性能样本", JSON.stringify(samples));
});

test("table edits keep validation, controlled writeback, undo and other editors isolated", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => !!window.databasePerformanceFixture);
  await page.evaluate(() => window.databasePerformanceFixture!.mountPair(100, false));
  const first = page.locator("#database-performance-0").getByLabel("第 1 行 文本");
  const read = async (index: number) =>
    (await page.evaluate(
      (id) => window.databasePerformanceFixture!.editors[id].getSnapshot().json.content![0].attrs!.data,
      index,
    )) as DatabaseData;
  const original = await read(0);
  const second = await read(1);
  await first.fill("新的内容");
  await page.evaluate(() => {
    const editor = window.databasePerformanceFixture!.editors[0];
    editor.setContent(structuredClone(editor.getSnapshot().json));
  });
  await expect(first).toBeFocused();
  expect((await read(0)).records[0].values[original.fields[0].id]).toBe("新的内容");
  expect(await read(1)).toEqual(second);
  await first.press("Enter");
  expect(await page.evaluate(() => window.databasePerformanceFixture!.editors[0].editor.commands.undo())).toBe(true);
  expect((await read(0)).records[0].values[original.fields[0].id]).toBe("记录 0");
  const beforeInvalid = await read(0);
  await page.evaluate(() => {
    const editor = window.databasePerformanceFixture!.editors[0];
    const content = editor.getSnapshot().json;
    const data = content.content![0].attrs!.data;
    data.records[0].unexpected = "不可丢失";
    editor.setContent(content);
  });
  expect(await read(0)).toEqual(beforeInvalid);
  expect(await page.evaluate(() => window.databasePerformanceFixture!.errors)).toHaveLength(1);
  expect(await read(1)).toEqual(second);
  await page.evaluate(() => window.databasePerformanceFixture!.editors.forEach((editor) => editor.destroy()));
});

test("automatic metadata fields still refresh after a table cell edit", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => !!window.databasePerformanceFixture);
  await page.evaluate(() => window.databasePerformanceFixture!.mountPair(3, true));
  const root = page.locator("#database-performance-0");
  await root.getByLabel("第 1 行 文本").fill("编辑内容");
  const data = (await page.evaluate(
    () => window.databasePerformanceFixture!.editors[0].getSnapshot().json.content![0].attrs!.data,
  )) as DatabaseData;
  const field = data.fields.find((item) => item.type === "modifiedTime")!;
  expect(data.records[0].values[field.id]).not.toBe("2020-01-01T00:00:00.000Z");
  await expect(root.getByLabel("第 1 行 修改时间")).toHaveText(
    databaseValueText(field, data.records[0].values[field.id]),
  );
  await page.evaluate(() => window.databasePerformanceFixture!.editors.forEach((editor) => editor.destroy()));
});

test("row drag uses current document state after rendering and remains undoable", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => !!window.databasePerformanceFixture);
  await page.evaluate(() => window.databasePerformanceFixture!.mountPair(3, false));
  const root = page.locator("#database-performance-0 .semlo-editor-database");
  const order = () =>
    root
      .locator('input[aria-label$=" 行 文本"]')
      .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  const handle = root.getByRole("button", { name: "移动第 3 条记录" });
  await handle.locator("..").hover();
  await handle.dragTo(root.locator(".semlo-editor-database-record-index").first(), { targetPosition: { x: 25, y: 2 } });
  expect(await order()).toEqual(["记录 2", "记录 0", "记录 1"]);
  expect(await page.evaluate(() => window.databasePerformanceFixture!.editors[0].editor.commands.undo())).toBe(true);
  expect(await order()).toEqual(["记录 0", "记录 1", "记录 2"]);
  await page.evaluate(() => window.databasePerformanceFixture!.editors[0].setEditable(false));
  await expect(root.getByRole("button", { name: "移动第 1 条记录", includeHidden: true })).toBeDisabled();
  await page.evaluate(() => window.databasePerformanceFixture!.editors[0].setEditable(true));
  await expect(root.getByRole("button", { name: "移动第 1 条记录", includeHidden: true })).toBeEnabled();
  await page.evaluate(() => window.databasePerformanceFixture!.editors.forEach((editor) => editor.destroy()));
});

test.skipIf(process.env.SEMLO_DATABASE_PROFILE !== "1")("profile the 1000-row database workload", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => !!window.databasePerformanceFixture);
  const client = await page.context().newCDPSession(page);
  await client.send("Profiler.enable");
  await client.send("Profiler.start");
  await page.evaluate(() => window.databasePerformanceFixture!.measure(1000));
  const { profile } = await client.send("Profiler.stop");
  await client.detach();
  const nodes = new Map(
    profile.nodes.map((node) => [
      node.id,
      `${node.callFrame.functionName || "(anonymous)"}:${node.callFrame.lineNumber + 1}`,
    ]),
  );
  const parents = new Map<number, number>();
  profile.nodes.forEach((node) => node.children?.forEach((child) => parents.set(child, node.id)));
  const times = new Map<string, number>();
  profile.samples?.forEach((node, index) => {
    const name = `${nodes.get(node) ?? "unknown"} <- ${nodes.get(parents.get(node) ?? -1) ?? "unknown"}`;
    times.set(name, (times.get(name) ?? 0) + (profile.timeDeltas?.[index] ?? 0));
  });
  console.log("数据库热点", JSON.stringify([...times].sort((a, b) => b[1] - a[1]).slice(0, 20)));
});
