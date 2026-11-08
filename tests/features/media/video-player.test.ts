import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";

import { readInlineFixtureBundle } from "../../fixtures/browser/fixture-bundle";
import type {} from "../../fixtures/media/video-player-fixture";

let directory: string, bundle: string, style: string, mp4: Buffer;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "semlo-video-player-"));
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { video: resolve("tests/fixtures/media/video-player-fixture.ts") } },
      resolve: { alias: { "@semlo-editor/core$": resolve("packages/core/dist/index.js") } },
      output: { distPath: { root: directory }, cleanDistPath: false, filename: { js: "[name].js" } },
      tools: { rspack: { optimization: { splitChunks: false, runtimeChunk: false } } },
    },
  });
  await build.build();
  bundle = await readInlineFixtureBundle(directory);
  style = await readFile(resolve("packages/core/dist/style.css"), "utf8");
  mp4 = await readFile(resolve("tests/fixtures/media/semlo-media-test.mp4"));
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function mount(page: Page, options: Parameters<Window["videoPlayerFixture"]["mount"]>[0] = {}) {
  await page.route("https://video.semlo.invalid/**", (route) => {
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? "");
    const first = range ? Number(range[1]) : 0;
    const last = range?.[2] ? Math.min(Number(range[2]), mp4.length - 1) : mp4.length - 1;
    return route.fulfill({
      status: range ? 206 : 200,
      contentType: "video/mp4",
      headers: {
        "accept-ranges": "bytes",
        ...(range ? { "content-range": `bytes ${first}-${last}/${mp4.length}` } : {}),
      },
      body: mp4.subarray(first, last + 1),
    });
  });
  await page.route("https://host.semlo.invalid/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}#video-editor,#video-second{max-width:800px;width:calc(100% - 24px);margin:32px auto}</style><div id="video-editor"></div><div id="video-second"></div>',
    }),
  );
  await page.goto("https://host.semlo.invalid/editor");
  await page.addStyleTag({ content: style });
  await page.addScriptTag({ content: bundle });
  await page.evaluate((value) => window.videoPlayerFixture.mount(value), options);
}

const card = (page: Page) => page.locator("#video-editor .semlo-editor-video-player");
const video = (page: Page) => card(page).locator("video");
const play = (page: Page) => card(page).getByRole("button", { name: "播放视频", exact: true });
const pause = (page: Page) => card(page).getByRole("button", { name: "暂停视频", exact: true });
const progress = (page: Page) => card(page).getByRole("slider", { name: "视频播放进度" });
const rate = (page: Page) => card(page).getByRole("combobox", { name: "视频播放速度" });
const mute = (page: Page) => card(page).getByRole("button", { name: "静音", exact: true });
async function metadata(page: Page) {
  await expect.poll(() => video(page).evaluate((element: HTMLVideoElement) => element.duration)).toBeGreaterThan(1.9);
  await expect
    .poll(() => video(page).evaluate((element: HTMLVideoElement) => element.seekable.length && element.seekable.end(0)))
    .toBeGreaterThan(1.9);
}

test("real video plays, seeks, changes speed and volume without changing content", async ({ page }) => {
  await mount(page);
  await metadata(page);
  const before = await page.evaluate(() => window.videoPlayerFixture.api.getSnapshot());
  expect(await video(page).evaluate((element: HTMLVideoElement) => element.controls)).toBe(false);
  await expect(rate(page).locator("option")).toHaveText(["2.0X", "1.5X", "1.25X", "1.0X", "0.75X", "0.5X"]);
  await expect(card(page).getByRole("link", { name: "下载视频" })).toHaveAttribute(
    "href",
    "https://video.semlo.invalid/sample.mp4",
  );
  const bounds = (await progress(page).boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(card(page).locator(".semlo-editor-video-progress-preview")).toHaveText("0:01");
  await expect(card(page).locator(".semlo-editor-video-rate > span")).toHaveText("倍速");
  await play(page).focus();
  await page.keyboard.press("Space");
  await expect.poll(() => video(page).evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
  await pause(page).click();
  await progress(page).focus();
  await page.keyboard.press("Home");
  expect(await video(page).evaluate((element: HTMLVideoElement) => element.currentTime)).toBe(0);
  await page.keyboard.press("ArrowRight");
  expect(await video(page).evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
  await rate(page).selectOption("2");
  expect(await video(page).evaluate((element: HTMLVideoElement) => element.playbackRate)).toBe(2);
  await expect(card(page).locator(".semlo-editor-video-rate > span")).toHaveText("2X");
  await mute(page).click();
  expect(await video(page).evaluate((element: HTMLVideoElement) => element.muted)).toBe(true);
  const volume = card(page).getByRole("slider", { name: "视频音量" });
  await volume.focus();
  await page.keyboard.press("ArrowUp");
  expect(
    await video(page).evaluate((element: HTMLVideoElement) => ({ muted: element.muted, volume: element.volume })),
  ).toEqual({
    muted: false,
    volume: 0.01,
  });
  await progress(page).focus();
  await page.keyboard.press("End");
  await expect
    .poll(() => video(page).evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(1.9);
  expect(await page.evaluate(() => window.videoPlayerFixture.api.getSnapshot())).toEqual(before);
  expect(await page.evaluate(() => window.videoPlayerFixture.changes)).toBe(0);
  expect(await page.evaluate(() => window.videoPlayerFixture.api.editor.can().undo())).toBe(false);
});

for (const echo of ["json", "html"] as const) {
  test(`${echo} controlled echo and old HTML keep video content and deletion undoable`, async ({ page }) => {
    await mount(page, { echo });
    const original = await page.evaluate(() => window.videoPlayerFixture.api.getSnapshot());
    expect(original.html).toContain(
      '<video src="https://video.semlo.invalid/sample.mp4" controls="" preload="metadata"',
    );
    expect(original.html).not.toContain("semlo-editor-video-controls");
    await page.evaluate(() => window.videoPlayerFixture.setAttrs({ name: "重命名.mp4" }));
    const renamed = await page.evaluate(() => window.videoPlayerFixture.api.getSnapshot());
    await metadata(page);
    const changes = await page.evaluate(() => window.videoPlayerFixture.changes);
    await rate(page).selectOption("1.5");
    await play(page).click();
    await expect
      .poll(() => video(page).evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThan(0);
    await pause(page).click();
    expect(await page.evaluate(() => window.videoPlayerFixture.api.getSnapshot())).toEqual(renamed);
    expect(await page.evaluate(() => window.videoPlayerFixture.changes)).toBe(changes);
    await card(page).getByRole("button", { name: "删除视频" }).click();
    await expect(video(page)).toHaveCount(0);
    await page.evaluate(() => window.videoPlayerFixture.api.editor.commands.undo());
    expect(await page.evaluate(() => window.videoPlayerFixture.api.getSnapshot())).toEqual(renamed);
    await page.evaluate(() => window.videoPlayerFixture.api.editor.commands.redo());
    await expect(video(page)).toHaveCount(0);
    await page.evaluate(() => window.videoPlayerFixture.api.editor.commands.undo());
    await page.evaluate((html) => window.videoPlayerFixture.mount({ content: html }), renamed.html);
    expect(await page.evaluate(() => window.videoPlayerFixture.api.getSnapshot())).toEqual(renamed);
    await page.evaluate((json) => window.videoPlayerFixture.mount({ content: json }), renamed.json);
    expect(await page.evaluate(() => window.videoPlayerFixture.api.getSnapshot())).toEqual(renamed);
  });
}

test("read-only playback and real fullscreen leave the document unchanged", async ({ page }) => {
  await mount(page, { editable: false });
  await metadata(page);
  const before = await page.evaluate(() => window.videoPlayerFixture.api.getSnapshot());
  await expect(card(page).getByRole("button", { name: "删除视频", includeHidden: true })).toBeHidden();
  await play(page).click();
  await expect.poll(() => video(page).evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
  await pause(page).click();
  await card(page).evaluate((element: HTMLElement) => {
    element.requestFullscreen = () => Promise.reject(new Error("simulated"));
  });
  await card(page).getByRole("button", { name: "全屏", exact: true }).click();
  await expect(card(page).getByRole("status")).toContainText("无法切换全屏");
  await card(page).evaluate((element: HTMLElement) => {
    delete (element as Partial<HTMLElement>).requestFullscreen;
  });
  await card(page).getByRole("button", { name: "全屏", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains("semlo-editor-video-player")))
    .toBe(true);
  await expect(card(page).getByRole("status", { includeHidden: true })).toBeHidden();
  await card(page).getByRole("button", { name: "退出全屏" }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
  expect(await page.evaluate(() => window.videoPlayerFixture.api.getSnapshot())).toEqual(before);
  expect(await page.evaluate(() => window.videoPlayerFixture.changes)).toBe(0);
});

test("source replacement, document replacement and destroy release only their own player", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => window.videoPlayerFixture.mountSecond());
  await metadata(page);
  await page.evaluate(() => {
    window.videoPlayerFixture.retained = document.querySelector<HTMLVideoElement>("#video-editor video")!;
    window.videoPlayerFixture.retained.currentTime = 0.5;
    window.videoPlayerFixture.setAttrs({ name: "新名称.mp4" });
  });
  expect(
    await page.evaluate(() => document.querySelector("#video-editor video") === window.videoPlayerFixture.retained),
  ).toBe(true);
  expect(await video(page).evaluate((element: HTMLVideoElement) => element.currentTime)).toBe(0.5);
  await page.evaluate(() => window.videoPlayerFixture.setAttrs({ src: "https://video.semlo.invalid/second.mp4" }));
  await metadata(page);
  expect(
    await page.evaluate(() => ({
      paused: window.videoPlayerFixture.retained!.paused,
      source: window.videoPlayerFixture.retained!.getAttribute("src"),
      connected: window.videoPlayerFixture.retained!.isConnected,
    })),
  ).toEqual({ paused: true, source: null, connected: false });
  await page.evaluate(() => {
    window.videoPlayerFixture.retained = document.querySelector<HTMLVideoElement>("#video-editor video")!;
    window.videoPlayerFixture.api.setContent({ type: "doc", content: [{ type: "paragraph" }] });
  });
  await expect(video(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.videoPlayerFixture.retained!.isConnected)).toBe(false);
  await expect(page.locator("#video-second video")).toHaveCount(1);
  await page.evaluate(() => window.videoPlayerFixture.api.destroy());
  await expect(page.locator("#video-second video")).toHaveCount(1);
  await page.evaluate(() => window.videoPlayerFixture.mount());
  await metadata(page);
});

test("unsafe source is preserved without loading and playback failure is recoverable", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mount(page);
  await page.evaluate(() => window.videoPlayerFixture.setAttrs({ src: "javascript:alert(1)" }));
  const unsafe = await page.evaluate(() => window.videoPlayerFixture.api.getSnapshot());
  await expect(video(page)).not.toHaveAttribute("src");
  await expect(play(page)).toBeDisabled();
  expect(unsafe.json.content![1].attrs!.src).toBe("javascript:alert(1)");
  await page.evaluate((html) => window.videoPlayerFixture.mount({ content: html }), unsafe.html);
  expect(await page.evaluate(() => window.videoPlayerFixture.api.getSnapshot())).toEqual(unsafe);
  await page.evaluate(() => window.videoPlayerFixture.setAttrs({ src: "https://video.semlo.invalid/sample.mp4" }));
  await metadata(page);
  await video(page).evaluate((element: HTMLVideoElement) => {
    element.play = () => Promise.reject(new Error("simulated"));
  });
  await play(page).click();
  await expect(card(page).getByRole("status")).toContainText("视频无法播放");
  await video(page).evaluate((element: HTMLVideoElement) => {
    delete (element as Partial<HTMLVideoElement>).play;
  });
  await play(page).click();
  await expect.poll(() => video(page).evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("a pending play cannot update a replaced player", async ({ page }) => {
  await mount(page);
  await metadata(page);
  await video(page).evaluate((element: HTMLVideoElement) => {
    window.videoPlayerFixture.retained = element;
    element.play = () =>
      new Promise<void>((resolve) => {
        window.videoPlayerFixture.settlePlay = resolve;
      });
  });
  await play(page).click();
  await page.evaluate(() => window.videoPlayerFixture.setAttrs({ src: "https://video.semlo.invalid/second.mp4" }));
  await metadata(page);
  await page.evaluate(() => window.videoPlayerFixture.settlePlay!());
  await expect(play(page)).toBeVisible();
  expect(await video(page).evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  expect(await page.evaluate(() => window.videoPlayerFixture.retained!.isConnected)).toBe(false);
});

test("picture-in-picture rejection and synchronous failure are reported without an uncaught error", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mount(page);
  await metadata(page);
  await page.evaluate(() => {
    Object.defineProperty(document, "pictureInPictureEnabled", { configurable: true, value: true });
  });
  for (const mode of ["reject", "throw"] as const) {
    await video(page).evaluate((element: HTMLVideoElement, value) => {
      element.requestPictureInPicture = () => {
        if (value === "throw") throw new Error("simulated");
        return Promise.reject(new Error("simulated"));
      };
    }, mode);
    await rate(page).selectOption(mode === "reject" ? "1.5" : "1");
    await card(page).getByRole("button", { name: "画中画" }).click();
    await expect(card(page).getByRole("status")).toContainText("无法切换画中画");
  }
  expect(errors).toEqual([]);
});

test("touch controls remain usable on a narrow screen", async ({ page }) => {
  const context = await page
    .context()
    .browser()!
    .newContext({
      viewport: { width: 360, height: 740 },
      isMobile: true,
      hasTouch: true,
    });
  try {
    const mobile = await context.newPage();
    await mount(mobile);
    await metadata(mobile);
    const button = (await play(mobile).boundingBox())!;
    expect(button.width).toBeGreaterThanOrEqual(44);
    await mobile.touchscreen.tap(button.x + button.width / 2, button.y + button.height / 2);
    await expect
      .poll(() => video(mobile).evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThan(0);
    const bounds = (await pause(mobile).boundingBox())!;
    await mobile.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await rate(mobile).selectOption("1.5");
    expect(await video(mobile).evaluate((element: HTMLVideoElement) => element.playbackRate)).toBe(1.5);
    const overflow = await card(mobile).evaluate((element) => ({
      width: element.clientWidth,
      scroll: element.scrollWidth,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.width + 1);
  } finally {
    await context.close();
  }
});
