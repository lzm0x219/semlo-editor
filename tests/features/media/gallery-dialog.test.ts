import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

import { expect, test, type Page } from "@rstest/playwright";

import type { GalleryData } from "../../../packages/core/src/features/media/gallery/extension";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { inlineMediaModules } from "../../fixtures/shared/media-inline-modules";

const uploads = stripTypeScriptTypes(readFileSync("packages/core/src/features/media/gallery/uploads.ts", "utf8"));
const dialog = inlineMediaModules([
  "packages/core/src/features/media/shared/modal-order.ts",
  "packages/core/src/features/media/gallery/dialog.ts",
]);
const styles = readFileSync("packages/core/src/features/media/gallery/dialog.css", "utf8");

declare global {
  interface Window {
    galleryDialogTest?: {
      open: (data: GalleryData) => void;
      close: () => void;
      commits: GalleryData[];
      errors: string[];
      closed: number;
      enabled: boolean;
      resolves: Partial<Record<string, (url: string) => void>>;
    };
  }
}

const empty: GalleryData = { id: "gallery-1", layout: "carousel", images: [] };
const populated: GalleryData = {
  id: "gallery-1",
  layout: "carousel",
  images: [
    { id: "a", src: "/a.png", title: "第一张", href: "https://example.com/a" },
    { id: "b", src: "/b.png", title: "第二张", href: "https://example.com/b" },
    { id: "c", src: "/c.png", title: "第三张", href: "https://example.com/c" },
  ],
};

async function mount(page: Page, data: GalleryData = empty) {
  await page.setContent('<button id="opener">打开图册设置</button>');
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({
    type: "module",
    content: `${uploads}\n${dialog}
      const state = {
        commits: [], errors: [], closed: 0, enabled: true, resolves: {}, close: () => {},
        open(data) {
          state.close = openGalleryDialog(document, data, {
            getUploadImage: () => state.enabled ? file => new Promise(resolve => { state.resolves[file.name] = resolve }) : undefined,
            onCommit: value => state.commits.push(value),
            onClose: () => state.closed++,
            onError: error => state.errors.push(String(error)),
          })
        },
      }
      window.galleryDialogTest = state
    `,
  });
  await page.waitForFunction(() => Boolean(window.galleryDialogTest));
  await page.locator("#opener").focus();
  await page.evaluate((value) => window.__semloRequireFixture("galleryDialogTest").open(value), data);
  return page.getByRole("dialog", { name: "图册设置" });
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("empty gallery offers three layouts and cancel leaves the original unchanged", async ({ page }) => {
  let panel = await mount(page);
  const bounds = await panel.boundingBox();
  expect(bounds?.width).toBe(535);
  expect(bounds?.x).toBe((1280 - 535) / 2);
  await expect(panel.getByText("版式选择", { exact: true })).toBeVisible();
  await expect(panel.getByText("上传图片", { exact: true })).toBeVisible();
  await expect(panel.locator(".semlo-editor-gallery-image-row")).toHaveCSS("height", "125px");
  await expect(panel.getByRole("button", { name: "上传图片" })).toHaveText("＋");
  await expect(panel.getByLabel("标题", { exact: true })).toHaveAttribute("placeholder", "输入标题（选填）");
  await expect(panel.getByLabel("链接", { exact: true })).toHaveAttribute("placeholder", "插入链接（选填）");
  await expect(panel.getByRole("button", { name: "轮播", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByLabel("标题", { exact: true })).toBeDisabled();
  await expect(panel.getByLabel("链接", { exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "平铺" }).click();
  await expect(panel.getByRole("button", { name: "平铺" })).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: "取消", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator("#opener")).toBeFocused();
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryDialogTest").commits)).toEqual([]);
  await page.evaluate((data) => window.__semloRequireFixture("galleryDialogTest").open(data), empty);
  panel = page.getByRole("dialog", { name: "图册设置" });
  await expect(panel.getByRole("button", { name: "轮播", exact: true })).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: "带缩略图的轮播" }).click();
  await panel.getByRole("button", { name: "确定", exact: true }).click();
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryDialogTest").commits)).toEqual([
    { ...empty, layout: "thumbnail" },
  ]);
});

test("the dialog matches the reference spacing and keeps actions visible in a short viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1380, height: 980 });
  const panel = await mount(page);
  const geometry = await panel.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const layouts = element.querySelector(".semlo-editor-gallery-layouts")!.getBoundingClientRect();
    const imagesLabel = element.querySelector(".semlo-editor-gallery-images-label")!.getBoundingClientRect();
    const upload = element.querySelector(".semlo-editor-gallery-upload")!.getBoundingClientRect();
    const fields = element.querySelectorAll<HTMLElement>(".semlo-editor-gallery-field");
    const titleLabel = fields[0].querySelector("span")!.getBoundingClientRect();
    const titleInput = fields[0].querySelector("input")!.getBoundingClientRect();
    const linkLabel = fields[1].querySelector("span")!.getBoundingClientRect();
    return {
      top: box.top,
      height: box.height,
      layoutGap: imagesLabel.top - layouts.bottom,
      uploadGap: titleLabel.top - upload.bottom,
      fieldGap: linkLabel.top - titleInput.bottom,
      imageRowHeight: element.querySelector(".semlo-editor-gallery-image-row")!.getBoundingClientRect().height,
    };
  });
  expect(geometry.top).toBeCloseTo(100, 0);
  expect(geometry.height).toBeGreaterThanOrEqual(678);
  expect(geometry.height).toBeLessThanOrEqual(686);
  expect(geometry.layoutGap).toBeCloseTo(40, 0);
  expect(geometry.uploadGap).toBeGreaterThanOrEqual(55);
  expect(geometry.uploadGap).toBeLessThanOrEqual(70);
  expect(geometry.fieldGap).toBeCloseTo(24, 0);
  expect(geometry.imageRowHeight).toBe(125);

  await page.setViewportSize({ width: 375, height: 500 });
  const box = (await panel.boundingBox())!;
  const confirm = (await panel.getByRole("button", { name: "确定", exact: true }).boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(16);
  expect(box.y + box.height).toBeLessThanOrEqual(484);
  expect(confirm.y + confirm.height).toBeLessThanOrEqual(484);
  await expect
    .poll(() =>
      panel
        .locator(".semlo-editor-gallery-dialog-body")
        .evaluate((element) => element.scrollHeight > element.clientHeight),
    )
    .toBe(true);
});

test("the upload tile stays fixed while thumbnails scroll horizontally on narrow screens", async ({ page }) => {
  const data: GalleryData = {
    ...populated,
    images: Array.from({ length: 8 }, (_, index) => ({ ...populated.images[0], id: `image-${index}` })),
  };
  const panel = await mount(page, data);
  const upload = panel.getByRole("button", { name: "上传图片" });
  const tiles = panel.locator(".semlo-editor-gallery-thumbnail");
  const uploadBox = (await upload.boundingBox())!;
  const first = (await tiles.nth(0).boundingBox())!;
  const second = (await tiles.nth(1).boundingBox())!;
  expect(uploadBox.width).toBe(72);
  expect(uploadBox.height).toBe(72);
  expect(first.x - (uploadBox.x + uploadBox.width)).toBe(43);
  expect(second.x - (first.x + first.width)).toBe(18);
  expect(await upload.evaluate((element) => getComputedStyle(element, "::after").width)).toBe("1px");

  await page.setViewportSize({ width: 320, height: 500 });
  const firstNarrow = (await tiles.nth(0).boundingBox())!;
  const secondNarrow = (await tiles.nth(1).boundingBox())!;
  expect(secondNarrow.y).toBeCloseTo(firstNarrow.y, 0);
  const list = tiles.first().locator("..");
  await expect.poll(() => list.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  const fixedUpload = (await upload.boundingBox())!;
  await list.evaluate((element) => (element.scrollLeft = 200));
  await expect.poll(async () => (await tiles.first().boundingBox())!.x).toBeLessThan(firstNarrow.x);
  expect((await upload.boundingBox())!.x).toBeCloseTo(fixedUpload.x, 0);
  const confirm = (await panel.getByRole("button", { name: "确定", exact: true }).boundingBox())!;
  expect(confirm.y + confirm.height).toBeLessThanOrEqual(484);
});

test("per-image edits and confirmed deletion stay in the draft until the dialog is committed", async ({ page }) => {
  let panel = await mount(page, populated);
  await panel.getByRole("button", { name: "图片二", exact: true }).click();
  await expect(panel.getByLabel("标题（图片二）")).toHaveValue("第二张");
  await panel.getByLabel("标题（图片二）").fill("修改标题");
  await panel.getByLabel("链接（图片二）").fill("https://example.com/new");
  await panel.getByRole("button", { name: "平铺" }).click();
  await panel.getByRole("button", { name: "图片二", exact: true }).hover();
  await panel.getByRole("button", { name: "删除图片二" }).click();
  let confirmation = panel.getByRole("alertdialog", { name: "删除图片确认" });
  await expect(confirmation).toContainText("确认删除该图片？");
  await confirmation.getByRole("button", { name: "取消" }).click();
  await expect(panel.getByRole("button", { name: "图片二", exact: true })).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: "图片二", exact: true }).hover();
  await panel.getByRole("button", { name: "删除图片二" }).click();
  confirmation = panel.getByRole("alertdialog", { name: "删除图片确认" });
  await confirmation.getByRole("button", { name: "确定" }).click();
  await expect(panel.getByRole("button", { name: "图片一", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByLabel("标题（图片一）")).toHaveValue("第一张");
  await panel.getByRole("button", { name: "取消", exact: true }).click();
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryDialogTest").commits)).toEqual([]);

  await page.evaluate((data) => window.__semloRequireFixture("galleryDialogTest").open(data), populated);
  panel = page.getByRole("dialog", { name: "图册设置" });
  await expect(panel.getByRole("button", { name: "轮播", exact: true })).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: "图片二", exact: true }).click();
  await expect(panel.getByLabel("标题（图片二）")).toHaveValue("第二张");
  await expect(panel.getByLabel("链接（图片二）")).toHaveValue("https://example.com/b");
  await panel.getByLabel("标题（图片二）").fill("新名称");
  await panel.getByLabel("链接（图片二）").fill("https://example.com/new");
  await panel.getByRole("button", { name: "平铺" }).click();
  await panel.getByRole("button", { name: "确定", exact: true }).click();
  const commits = await page.evaluate(() => window.__semloRequireFixture("galleryDialogTest").commits);
  expect(commits).toEqual([
    {
      ...populated,
      layout: "grid",
      images: [
        populated.images[0],
        { ...populated.images[1], title: "新名称", href: "https://example.com/new" },
        populated.images[2],
      ],
    },
  ]);
});

test("delete confirmation stays within the dialog when thumbnails scroll or the viewport narrows", async ({ page }) => {
  const data: GalleryData = {
    ...populated,
    images: Array.from({ length: 8 }, (_, index) => ({ ...populated.images[0], id: `image-${index}` })),
  };
  const panel = await mount(page, data);
  await panel.getByRole("button", { name: "图片五", exact: true }).click();
  await panel.getByRole("button", { name: "图片五", exact: true }).hover();
  await panel.getByRole("button", { name: "删除图片五" }).click();
  const confirmation = panel.getByRole("alertdialog", { name: "删除图片确认" });
  const assertInside = async () => {
    const box = await confirmation.boundingBox();
    const container = await panel.locator(".semlo-editor-gallery-dialog-body").boundingBox();
    if (!box || !container) return false;
    return box.x >= container.x && box.x + box.width <= container.x + container.width;
  };
  await expect.poll(assertInside).toBe(true);
  await page.setViewportSize({ width: 375, height: 667 });
  await expect.poll(assertInside).toBe(true);
  await confirmation.getByRole("button", { name: "取消" }).click();
  await expect(panel.getByRole("button", { name: "图片五", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("dragging and keyboard arrows reorder images while keeping the selected image", async ({ page }) => {
  const panel = await mount(page, populated);
  await panel.getByRole("button", { name: "图片一", exact: true }).hover();
  await panel
    .getByRole("button", { name: "拖动图片一" })
    .dragTo(panel.getByRole("button", { name: "图片三", exact: true }));
  await expect(panel.getByRole("button", { name: "图片三", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByLabel("标题（图片三）")).toHaveValue("第一张");
  await panel.getByRole("button", { name: "图片三", exact: true }).focus();
  await panel.getByRole("button", { name: "拖动图片三" }).press("ArrowLeft");
  await expect(panel.getByRole("button", { name: "图片二", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByLabel("标题（图片二）")).toHaveValue("第一张");
  await panel.getByRole("button", { name: "确定", exact: true }).click();
  const committed = await page.evaluate(() => window.__semloRequireFixture("galleryDialogTest").commits[0]);
  expect(committed.images.map((image) => image.id)).toEqual(["b", "a", "c"]);
});

test("uploads keep file order, block confirmation while pending, and ignore results after cancel", async ({ page }) => {
  let panel = await mount(page);
  const chooseFiles = panel.locator('input[type="file"]');
  await chooseFiles.setInputFiles([
    { name: "first.png", mimeType: "image/png", buffer: Buffer.from("first") },
    { name: "second.png", mimeType: "image/png", buffer: Buffer.from("second") },
  ]);
  await expect(panel.getByRole("button", { name: "确定", exact: true })).toBeDisabled();
  await page.waitForFunction(() => Boolean(window.__semloRequireFixture("galleryDialogTest").resolves["first.png"]));
  await page.waitForFunction(() => Boolean(window.__semloRequireFixture("galleryDialogTest").resolves["second.png"]));
  await page.evaluate(() =>
    (
      window.__semloRequireFixture("galleryDialogTest").resolves["second.png"] ??
      (() => {
        throw new Error("Gallery upload second.png is not pending");
      })()
    )("https://example.com/second.png"),
  );
  await expect(panel.getByRole("button", { name: "图片一", exact: true })).toHaveCount(0);
  await page.evaluate(() =>
    (
      window.__semloRequireFixture("galleryDialogTest").resolves["first.png"] ??
      (() => {
        throw new Error("Gallery upload first.png is not pending");
      })()
    )("https://example.com/first.png"),
  );
  await expect(panel.getByRole("button", { name: "图片一", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "图片二", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "确定", exact: true })).toBeEnabled();
  await panel.getByRole("button", { name: "确定", exact: true }).click();
  const committed = await page.evaluate(() => window.__semloRequireFixture("galleryDialogTest").commits[0]);
  expect(committed.images.map((image) => image.src)).toEqual([
    "https://example.com/first.png",
    "https://example.com/second.png",
  ]);

  await page.evaluate((data) => window.__semloRequireFixture("galleryDialogTest").open(data), empty);
  panel = page.getByRole("dialog", { name: "图册设置" });
  await panel.locator('input[type="file"]').setInputFiles({
    name: "late.png",
    mimeType: "image/png",
    buffer: Buffer.from("late"),
  });
  await page.waitForFunction(() => Boolean(window.__semloRequireFixture("galleryDialogTest").resolves["late.png"]));
  await panel.getByRole("button", { name: "取消", exact: true }).click();
  await page.evaluate(() =>
    (
      window.__semloRequireFixture("galleryDialogTest").resolves["late.png"] ??
      (() => {
        throw new Error("Gallery upload late.png is not pending");
      })()
    )("https://example.com/late.png"),
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryDialogTest").commits)).toHaveLength(1);
  await page.evaluate((data) => window.__semloRequireFixture("galleryDialogTest").open(data), empty);
  await expect(page.getByRole("button", { name: "图片一", exact: true })).toHaveCount(0);
});

test("missing upload integration reports an error and Escape cancels without committing", async ({ page }) => {
  const panel = await mount(page);
  await page.evaluate(() => (window.__semloRequireFixture("galleryDialogTest").enabled = false));
  await panel.locator('input[type="file"]').setInputFiles({
    name: "image.png",
    mimeType: "image/png",
    buffer: Buffer.from("image"),
  });
  await expect(panel.getByRole("status")).toContainText("请先配置图片上传");
  await expect(panel.getByRole("button", { name: "确定", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryDialogTest").commits)).toEqual([]);
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryDialogTest").errors)).toHaveLength(1);
});
