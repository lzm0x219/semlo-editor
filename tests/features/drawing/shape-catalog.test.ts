import { resolve } from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";

import type { CanvasData } from "../../../packages/core/src/features/drawing/canvas/model";
import { libraryShapeNames } from "../../../packages/core/src/features/drawing/canvas/shape-library";
import type {} from "../../fixtures/drawing/shape-catalog-fixture";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/drawing/shape-catalog-fixture.ts" } },
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
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.shapeCatalogFixture));
  await page.evaluate(() => window.shapeCatalogFixture.mount("A"));
});
const host = (page: Page, id = "A") => page.locator(`#shape-catalog-${id}`);
const snapshot = (page: Page, id = "A") => page.evaluate((id) => window.shapeCatalogFixture.snapshot(id), id);
async function data(page: Page, id = "A"): Promise<CanvasData> {
  return (await snapshot(page, id)).json.content!.find((node) => node.type === "semloEditorCanvas")!.attrs!.data;
}
async function choose(page: Page, category: string, label: string, id = "A") {
  await host(page, id).getByRole("button", { name: "更多形状", exact: true }).click();
  const panel = host(page, id).getByRole("dialog", { name: "图形库" });
  await panel
    .getByRole("navigation", { name: "图形分类" })
    .getByRole("button", { name: category, exact: true })
    .click();
  await panel
    .getByRole("region", { name: category, exact: true })
    .getByRole("button", { name: label, exact: true })
    .click();
  await expect(panel).toHaveCount(0);
}
async function place(page: Page, x = 120, y = 60, id = "A") {
  const stage = host(page, id).locator(".semlo-editor-canvas-stage");
  const box = await stage.boundingBox();
  if (!box) throw new Error("画布不存在");
  await stage.click({ position: { x: (x * box.width) / 800, y: (y * box.height) / 440 } });
}

for (const width of [1280, 375]) {
  test(`画布工具分组、图形键盘选择及平移入口（${width}px）`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const canvas = host(page);
    const rail = canvas.locator(".semlo-editor-canvas-tool-rail");
    const viewControls = canvas.locator(".semlo-editor-canvas-view-controls");
    expect(
      await rail.locator("button").evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
    ).toEqual(["选择", "画笔", "橡皮", "文本", "更多形状", "连线", "插入画布图片"]);
    const pan = viewControls.getByRole("button", { name: "平移", exact: true });
    await expect(pan).toBeVisible();
    const before = await snapshot(page);
    const trigger = rail.getByRole("button", { name: "更多形状", exact: true });
    await trigger.click();
    const rectangle = canvas
      .getByRole("dialog", { name: "图形库" })
      .getByRole("region", { name: "基础图形" })
      .getByRole("button", { name: "矩形", exact: true });
    await rectangle.focus();
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-pressed", "true");
    await place(page, 300, 200);
    expect((await data(page)).shapes.filter((shape) => shape.shape === "rectangle")).toHaveLength(2);
    expect(await page.evaluate(() => window.shapeCatalogFixture.undo("A"))).toBe(true);
    expect((await snapshot(page)).json).toEqual(before.json);
    await pan.click();
    await expect(pan).toHaveAttribute("aria-pressed", "true");
    await expect(trigger).toHaveAttribute("aria-pressed", "false");
  });
}

test("图形库五类连续展示，导航滚动到类别并支持方向键和Esc", async ({ page }) => {
  const before = await snapshot(page);
  await host(page).getByRole("button", { name: "更多形状", exact: true }).click();
  const panel = host(page).getByRole("dialog", { name: "图形库" });
  await expect(panel.locator("[data-shape-catalog-item]")).toHaveCount(93);
  await expect(panel.locator("section")).toHaveCount(5);
  const uml = panel.getByRole("navigation").getByRole("button", { name: "UML", exact: true });
  await uml.click();
  await expect(uml).toHaveAttribute("aria-current", "location");
  expect(await panel.locator('[data-shape-category="basic"]').count()).toBe(1);
  expect(
    await panel.evaluate((element) => {
      const list = element.querySelector(".semlo-editor-canvas-shape-list")!.getBoundingClientRect();
      const section = element.querySelector('[data-shape-category="uml"]')!.getBoundingClientRect();
      return Math.abs(list.top - section.top);
    }),
  ).toBeLessThan(12);
  await uml.press("ArrowRight");
  await expect(panel.getByRole("navigation").getByRole("button", { name: "ER", exact: true })).toBeFocused();
  await panel.locator("[data-shape-catalog-item]").first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(panel.locator("[data-shape-catalog-item]").nth(1)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(host(page).getByRole("button", { name: "更多形状", exact: true })).toBeFocused();
  expect((await snapshot(page)).json).toEqual(before.json);
  await choose(page, "Smart", "金字塔");
  await host(page).locator(".semlo-editor-canvas-stage").press("Escape");
  await place(page);
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("图标实际轮廓清晰占据缩略图，宿主nav样式不使分类换行", async ({ page }) => {
  await page.setViewportSize({ width: 812, height: 988 });
  // 复现验收宿主对普通 nav 的通用样式，组件需声明自己的单行布局。
  await page.addStyleTag({ content: "nav{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0}" });
  const before = await snapshot(page);
  await host(page).getByRole("button", { name: "更多形状", exact: true }).click();
  const panel = host(page).getByRole("dialog", { name: "图形库" });
  const nav = panel.getByRole("navigation", { name: "图形分类" });
  await expect(nav).toHaveCSS("flex-wrap", "nowrap");
  await expect(nav).toHaveCSS("gap", "0px");
  await expect(nav).toHaveCSS("margin", "0px");
  const positions = await nav
    .getByRole("button")
    .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().top));
  expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(1);
  const geometry = await panel.locator("[data-shape-catalog-item]").evaluateAll((buttons) =>
    buttons.map((button) => {
      const svg = button.querySelector("svg")!;
      const viewport = svg.getBoundingClientRect();
      const parts = Array.from(svg.querySelectorAll("path,rect,ellipse,circle,polygon"), (part) =>
        part.getBoundingClientRect(),
      );
      const left = Math.min(...parts.map((part) => part.left));
      const top = Math.min(...parts.map((part) => part.top));
      const right = Math.max(...parts.map((part) => part.right));
      const bottom = Math.max(...parts.map((part) => part.bottom));
      return {
        tool: (button as HTMLElement).dataset.shapeTool,
        coverage: Math.max(right - left, bottom - top) / Math.max(viewport.width, viewport.height),
        padding: Math.min(left - viewport.left, top - viewport.top, viewport.right - right, viewport.bottom - bottom),
      };
    }),
  );
  expect(geometry).toHaveLength(93);
  for (const item of geometry) {
    expect(item.coverage, item.tool).toBeGreaterThan(0.72);
    expect(item.padding, item.tool).toBeGreaterThan(0.4);
  }
  // 独立光栅化正控制，避免只有 SVG 节点却实际画成几像素小点。
  const ink = await panel.evaluate(async (element) => {
    const result = [];
    for (const tool of ["rectangle", "actor", "smartPyramid"]) {
      const svg = element.querySelector(`[data-shape-tool="${tool}"] svg`)!.cloneNode(true) as SVGSVGElement;
      svg.setAttribute("width", "22");
      svg.setAttribute("height", "22");
      const url = URL.createObjectURL(
        new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }),
      );
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 22;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0, 22, 22);
        const pixels = context.getImageData(0, 0, 22, 22).data;
        let dark = 0;
        for (let index = 0; index < pixels.length; index += 4)
          if (pixels[index + 3] > 32 && pixels[index] + pixels[index + 1] + pixels[index + 2] < 600) dark++;
        result.push({ tool, dark });
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    return result;
  });
  for (const item of ink) expect(item.dark, item.tool).toBeGreaterThan(20);
  await nav.getByRole("button", { name: "基础图形", exact: true }).focus();
  await page.keyboard.press("End");
  const er = nav.getByRole("button", { name: "ER", exact: true });
  await expect(er).toBeFocused();
  await expect(er).toHaveAttribute("aria-current", "location");
  const navBox = await nav.boundingBox();
  const erBox = await er.boundingBox();
  expect(erBox!.x + erBox!.width).toBeLessThanOrEqual(navBox!.x + navBox!.width + 1);
  expect((await snapshot(page)).json).toEqual(before.json);
});

for (const [category, label, type, count] of [
  ["基础图形", "圆形", "circle", 1],
  ["流程图", "数据库", "database", 2],
  ["UML", "类", "umlClass", 2],
  ["UML", "开始", "umlStart", 1],
  ["ER", "弱关系", "erWeakRelationship", 2],
] as const) {
  test(`${category} 的 ${label} 通过真实面板创建并保留其专有轮廓`, async ({ page }) => {
    const before = await data(page);
    await choose(page, category, label);
    await place(page, 350, 150);
    const after = await data(page);
    const added = after.shapes.find((shape) => shape.id !== "original")!;
    expect(added.shape).toBe(type);
    expect(after.shapes.find((shape) => shape.id === "original")).toEqual(before.shapes[0]);
    const target = host(page).locator(`[data-shape-id="${added.id}"]`);
    await expect(target.locator("svg path")).toHaveCount(count);
    if (type === "database" || type === "umlStart") {
      await host(page).getByRole("button", { name: "填充", exact: true }).click();
      await host(page).getByLabel("图形填充颜色", { exact: true }).fill("#aabbcc");
      await expect(target.locator("svg path").first()).toHaveAttribute("fill", "#aabbcc");
    }
    const saved = await snapshot(page);
    await page.evaluate((content) => window.shapeCatalogFixture.setContent("A", content), saved.html);
    expect((await snapshot(page)).json).toEqual(saved.json);
  });
}

const smart = [
  ["金字塔", ["第一层", "第二层", "第三层"]],
  ["分段金字塔", ["观点一", "观点二", "观点三", "观点四"]],
  ["阶段图", ["阶段一", "阶段二", "阶段三"]],
  ["架构图", ["模块1.1", "模块1.2", "模块2", "模块3.1", "模块3.2"]],
] as const;
for (const [label, labels] of smart) {
  test(`Smart ${label} 一次创建真实可编辑组，移动/删除/撤销和往返保留结构`, async ({ page }) => {
    const before = await snapshot(page);
    await choose(page, "Smart", label);
    expect((await snapshot(page)).json).toEqual(before.json);
    await place(page);
    const inserted = await snapshot(page);
    const initial = await data(page);
    expect(initial.groups).toHaveLength(1);
    const members = initial.shapes.filter((shape) => shape.id !== "original");
    expect(initial.groups![0].members).toEqual(members.map((shape) => shape.id));
    expect(members.filter((shape) => shape.shape === "text").map((shape) => shape.text)).toEqual([...labels]);
    expect(Math.min(...members.map((shape) => shape.x))).toBeCloseTo(120);
    expect(Math.min(...members.map((shape) => shape.y))).toBeCloseTo(60, 1);
    expect(
      Math.max(...members.map((shape) => shape.x + shape.width)) - Math.min(...members.map((shape) => shape.x)),
    ).toBeCloseTo(450);
    await expect(host(page).locator(".semlo-editor-canvas-group-outline")).toHaveCount(1);
    expect(await page.evaluate(() => window.shapeCatalogFixture.undo("A"))).toBe(true);
    expect((await snapshot(page)).json).toEqual(before.json);
    expect(await page.evaluate(() => window.shapeCatalogFixture.redo("A"))).toBe(true);
    expect((await snapshot(page)).json).toEqual(inserted.json);
    await host(page)
      .getByRole("button", { name: `图形：${labels[0]}`, exact: true })
      .click();
    const stage = host(page).locator(".semlo-editor-canvas-stage");
    await stage.press("ArrowRight");
    const moved = await snapshot(page);
    expect((await data(page)).shapes.find((shape) => shape.id === members[0].id)!.x).toBeCloseTo(members[0].x + 1);
    expect(await page.evaluate(() => window.shapeCatalogFixture.undo("A"))).toBe(true);
    expect((await snapshot(page)).json).toEqual(inserted.json);
    expect(await page.evaluate(() => window.shapeCatalogFixture.redo("A"))).toBe(true);
    expect((await snapshot(page)).json).toEqual(moved.json);
    await host(page)
      .getByRole("button", { name: `图形：${labels[0]}`, exact: true })
      .dblclick();
    await host(page).getByLabel("编辑图形文字", { exact: true }).fill(`${labels[0]}修改`);
    await host(page).getByLabel("编辑图形文字", { exact: true }).press("Tab");
    const edited = await snapshot(page);
    const deleted = structuredClone(before.json);
    // 既有组合删除会保留空 groups，仍精确检查其余正文和图形没有变化。
    deleted.content![0].attrs!.data.groups = [];
    await stage.press("Backspace");
    expect((await snapshot(page)).json).toEqual(deleted);
    expect(await page.evaluate(() => window.shapeCatalogFixture.undo("A"))).toBe(true);
    expect((await snapshot(page)).json).toEqual(edited.json);
    expect(await page.evaluate(() => window.shapeCatalogFixture.redo("A"))).toBe(true);
    expect((await snapshot(page)).json).toEqual(deleted);
    for (const content of [edited.json, edited.html]) {
      await page.evaluate((content) => window.shapeCatalogFixture.setContent("A", content), content);
      expect((await snapshot(page)).json).toEqual(edited.json);
    }
  });
}

test("所有新增类型经实际HTML读取再保存，未知字段保留并禁止误编辑", async ({ page }) => {
  const original = await snapshot(page);
  const content = structuredClone(original.json);
  const shapes = libraryShapeNames.map((shape, index) => ({
    id: `library-${index}`,
    shape,
    x: (index % 6) * 140,
    y: Math.floor(index / 6) * 100,
    width: 120,
    height: 80,
    text: `${shape}<&>`,
    fill: "#ddeeff",
    stroke: "#224466",
    strokeWidth: 3,
    rotation: index % 2 ? 30 : 0,
  }));
  content.content![0].attrs!.data = { shapes, edges: [] };
  await page.evaluate((content) => window.shapeCatalogFixture.setContent("A", content), content);
  const saved = await snapshot(page);
  await expect(host(page).locator(".semlo-editor-canvas-shape")).toHaveCount(shapes.length);
  for (const type of ["multiDocument", "umlMultiObject"]) {
    const id = shapes.find((shape) => shape.shape === type)!.id;
    await expect(host(page).locator(`[data-shape-id="${id}"] svg path`)).toHaveCount(3);
  }
  await page.evaluate((content) => window.shapeCatalogFixture.setContent("A", content), saved.html);
  expect((await snapshot(page)).json).toEqual(saved.json);
  const future = structuredClone(saved.json);
  future.content![0].attrs!.data.shapes[0].future = { preserve: "原始值" };
  await page.evaluate((content) => window.shapeCatalogFixture.setContent("A", content), future);
  await expect(host(page).getByRole("status")).toHaveText("画布数据格式不受支持，暂无法编辑。");
  await expect(host(page).getByRole("button", { name: "更多形状" })).toHaveCount(0);
  const unsupported = await snapshot(page);
  await page.evaluate((content) => window.shapeCatalogFixture.setContent("A", content), unsupported.html);
  expect((await snapshot(page)).json).toEqual(unsupported.json);
  expect((await data(page)).shapes[0]).toHaveProperty("future", { preserve: "原始值" });
});

test("新图形可连接，Smart缩放取消与旋转仍使用既有变换和历史", async ({ page }) => {
  await choose(page, "基础图形", "圆形");
  await place(page, 350, 120);
  await host(page).getByRole("button", { name: "连线", exact: true }).click();
  const circle = (await data(page)).shapes.find((shape) => shape.shape === "circle")!;
  await host(page).locator(`[data-shape-id="${circle.id}"]`).click();
  await host(page).getByRole("button", { name: "图形：原图形", exact: true }).click();
  expect((await data(page)).edges).toHaveLength(1);
  await expect(host(page).locator(".semlo-editor-canvas-edge")).toHaveCount(1);
  await choose(page, "Smart", "架构图");
  await place(page);
  const before = await snapshot(page);
  const resize = host(page).locator('.semlo-editor-canvas-group-resize[data-corner="se"]');
  const resizeBox = await resize.boundingBox();
  if (!resizeBox) throw new Error("组合缩放柄不存在");
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeBox.x + 40, resizeBox.y + 30, { steps: 4 });
  await resize.dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  expect((await snapshot(page)).json).toEqual(before.json);
  const outline = await host(page).locator(".semlo-editor-canvas-group-outline").boundingBox();
  const rotate = await host(page).getByRole("button", { name: "旋转编组", exact: true }).boundingBox();
  if (!outline || !rotate) throw new Error("组合旋转柄不存在");
  const cx = outline.x + outline.width / 2,
    cy = outline.y + outline.height / 2;
  const sx = rotate.x + rotate.width / 2,
    sy = rotate.y + rotate.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(
    cx + (sx - cx) * Math.SQRT1_2 - (sy - cy) * Math.SQRT1_2,
    cy + (sx - cx) * Math.SQRT1_2 + (sy - cy) * Math.SQRT1_2,
    { steps: 6 },
  );
  await page.mouse.up();
  expect((await data(page)).shapes.some((shape) => Math.abs(shape.rotation ?? 0) > 10)).toBe(true);
  expect(await page.evaluate(() => window.shapeCatalogFixture.undo("A"))).toBe(true);
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("只读/销毁/重挂关闭本实例图形库，另一个实例继续创建", async ({ page }) => {
  await page.evaluate(() => window.shapeCatalogFixture.mount("B"));
  const secondBefore = await snapshot(page, "B");
  const trigger = host(page).getByRole("button", { name: "更多形状", exact: true });
  await trigger.click();
  await page.evaluate(() => window.shapeCatalogFixture.editable("A", false));
  await expect(host(page).getByRole("dialog", { name: "图形库" })).toHaveCount(0);
  await expect(trigger).toBeDisabled();
  await page.evaluate(() => window.shapeCatalogFixture.editable("A", true));
  await trigger.click();
  await page.evaluate(() => window.shapeCatalogFixture.unmount("A"));
  await expect(page.getByRole("dialog", { name: "图形库" })).toHaveCount(0);
  await page.evaluate(() => window.shapeCatalogFixture.remount("A"));
  await host(page).getByRole("button", { name: "更多形状", exact: true }).click();
  await page.evaluate(() => window.shapeCatalogFixture.destroy("A"));
  await expect(page.getByRole("dialog", { name: "图形库" })).toHaveCount(0);
  expect((await snapshot(page, "B")).json).toEqual(secondBefore.json);
  await choose(page, "UML", "节点", "B");
  await place(page, 350, 120, "B");
  expect((await data(page, "B")).shapes.some((shape) => shape.shape === "umlNode")).toBe(true);
});

test("窄屏触摸打开、类别横向溢出和键盘选择均可用", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 780 }, hasTouch: true });
  try {
    const page = await context.newPage();
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.shapeCatalogFixture));
    await page.addStyleTag({ content: "nav{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0}" });
    await page.evaluate(() => window.shapeCatalogFixture.mount("M"));
    await host(page, "M").getByRole("button", { name: "更多形状", exact: true }).tap();
    const panel = host(page, "M").getByRole("dialog", { name: "图形库" });
    const bounds = await panel.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
    const nav = panel.getByRole("navigation");
    await expect(nav).toHaveCSS("flex-wrap", "nowrap");
    await nav.getByRole("button", { name: "基础图形", exact: true }).press("End");
    await expect(nav.getByRole("button", { name: "ER", exact: true })).toBeFocused();
    await nav.getByRole("button", { name: "ER", exact: true }).tap();
    await panel
      .getByRole("region", { name: "ER", exact: true })
      .getByRole("button", { name: "多值属性", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await place(page, 350, 160, "M");
    expect((await data(page, "M")).shapes.some((shape) => shape.shape === "erMultiAttribute")).toBe(true);
  } finally {
    await context.close();
  }
});
