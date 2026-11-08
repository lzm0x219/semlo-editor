import { resolve } from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";

import type {} from "../../fixtures/drawing/uml-actor-fixture";

type Shape = { id: string; shape: string; x: number; y: number; text: string };
let origin = "";
let stop: (() => Promise<void>) | undefined;

beforeAll(async () => {
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/drawing/uml-actor-fixture.ts" } },
      resolve: {
        alias: {
          "@semlo-editor/core$": resolve("packages/core/dist/index.js"),
          "@semlo-editor/core/style.css": resolve("packages/core/dist/style.css"),
        },
      },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await build.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = () => server.close();
});
afterAll(async () => stop?.());

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.umlActorFixture));
  await page.evaluate(() => window.umlActorFixture.mount("A"));
});

const host = (page: Page, id = "A") => page.locator(`#uml-actor-${id}`);
const snapshot = (page: Page, id = "A") => page.evaluate((id) => window.umlActorFixture.snapshot(id), id);
async function shapes(page: Page, id = "A"): Promise<Shape[]> {
  return (await snapshot(page, id)).json.content!.find((node) => node.type === "semloEditorCanvas")!.attrs!.data.shapes;
}

async function createActor(page: Page, id = "A") {
  const before = await shapes(page, id);
  await host(page, id).getByRole("button", { name: "更多形状", exact: true }).click();
  await host(page, id)
    .getByRole("dialog", { name: "图形库" })
    .getByRole("button", { name: "角色", exact: true })
    .click();
  await host(page, id)
    .locator(".semlo-editor-canvas-stage")
    .click({ position: { x: 400, y: 220 + (before.length - 2) * 80 } });
  const added = (await shapes(page, id)).find((shape) => !before.some((old) => old.id === shape.id));
  expect(added?.shape).toBe("actor");
  expect((await shapes(page, id)).filter((shape) => before.some((old) => old.id === shape.id))).toEqual(before);
  return added!;
}

test("从更多形状新建参与者，保留原图形并可单步撤销重做", async ({ page }) => {
  const before = await snapshot(page);
  const actor = await createActor(page);
  const target = host(page).locator(`[data-shape-id="${actor.id}"]`);
  await expect(target.locator(".semlo-editor-canvas-actor-icon")).toHaveCount(1);
  const inserted = await snapshot(page);
  expect(await page.evaluate(() => window.umlActorFixture.undo("A"))).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(await page.evaluate(() => window.umlActorFixture.redo("A"))).toBe(true);
  expect((await snapshot(page)).json).toEqual(inserted.json);
  await expect(host(page).getByRole("button", { name: "图形：原参与者", exact: true })).toBeVisible();
  await expect(host(page).getByRole("button", { name: "图形：原用例", exact: true })).toBeVisible();
});

test("新参与者沿用文字编辑、键盘移动、删除与逐步历史", async ({ page }) => {
  const original = await shapes(page);
  const actor = await createActor(page);
  const target = host(page).locator(`[data-shape-id="${actor.id}"]`);
  await target.dblclick();
  await host(page).getByLabel("编辑图形文字", { exact: true }).fill("新增参与者");
  await host(page).getByLabel("编辑图形文字", { exact: true }).press("Tab");
  const edited = await snapshot(page);
  await target.click();
  await target.press("ArrowRight");
  const moved = await snapshot(page);
  expect((await shapes(page)).find((shape) => shape.id === actor.id)?.x).toBe(actor.x + 1);
  expect(await page.evaluate(() => window.umlActorFixture.undo("A"))).toBe(true);
  expect((await snapshot(page)).json).toEqual(edited.json);
  expect(await page.evaluate(() => window.umlActorFixture.redo("A"))).toBe(true);
  expect((await snapshot(page)).json).toEqual(moved.json);
  await target.click();
  await target.press("Delete");
  await expect(target).toHaveCount(0);
  expect(await shapes(page)).toEqual(original);
  expect(await page.evaluate(() => window.umlActorFixture.undo("A"))).toBe(true);
  expect((await snapshot(page)).json).toEqual(moved.json);
  expect(await page.evaluate(() => window.umlActorFixture.redo("A"))).toBe(true);
  expect(await shapes(page)).toEqual(original);
});

test("新增参与者经 JSON 和 HTML 恢复；只读及多个实例互不写入", async ({ page }) => {
  const actor = await createActor(page);
  const saved = await snapshot(page);
  await page.evaluate((saved) => {
    window.umlActorFixture.mount("B", saved.json);
    window.umlActorFixture.mount("C", saved.html);
    window.umlActorFixture.editable("A", false);
  }, saved);
  expect((await snapshot(page, "B")).json).toEqual(saved.json);
  expect((await snapshot(page, "C")).json).toEqual(saved.json);
  await expect(host(page).getByRole("button", { name: "更多形状", exact: true })).toBeDisabled();
  await expect(host(page, "B").getByRole("button", { name: "更多形状", exact: true })).toBeEnabled();
  await expect(host(page, "C").locator(`[data-shape-id="${actor.id}"] .semlo-editor-canvas-actor-icon`)).toHaveCount(1);
  await host(page).locator(".semlo-editor-canvas-stage").press("Delete");
  expect((await snapshot(page)).json).toEqual(saved.json);
  await createActor(page, "B");
  expect((await snapshot(page)).json).toEqual(saved.json);
  expect((await snapshot(page, "C")).json).toEqual(saved.json);
  await page.evaluate(() => window.umlActorFixture.destroy("B"));
  await page.evaluate(() => window.umlActorFixture.editable("A", true));
  await expect(host(page).getByRole("button", { name: "更多形状", exact: true })).toBeEnabled();
  await createActor(page);
  expect((await snapshot(page, "C")).json).toEqual(saved.json);
});
