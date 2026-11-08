import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";

import { readInlineFixtureBundle } from "../../fixtures/browser/fixture-bundle";
import type {} from "../../fixtures/media/audio-player-fixture";

let directory: string, bundle: string, style: string, wav: Buffer;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "semlo-audio-player-"));
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { audio: resolve("tests/fixtures/media/audio-player-fixture.ts") } },
      resolve: { alias: { "@semlo-editor/core$": resolve("packages/core/dist/index.js") } },
      output: { distPath: { root: directory }, cleanDistPath: false, filename: { js: "[name].js" } },
      tools: { rspack: { optimization: { splitChunks: false, runtimeChunk: false } } },
    },
  });
  await build.build();
  bundle = await readInlineFixtureBundle(directory);
  style = await readFile(resolve("packages/core/dist/style.css"), "utf8");
  wav = await readFile(resolve("tests/fixtures/media/semlo-media-test.wav"));
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function mount(page: Page, options: Parameters<Window["audioPlayerFixture"]["mount"]>[0] = {}) {
  await page.route("https://audio.semlo.invalid/**", (route) => {
    // 真实媒体跳转要求可读取范围；始终返回 200 会使 Chromium 的 seekable 停在 [0, 0]。
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? "");
    const first = range ? Number(range[1]) : 0;
    const last = range?.[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
    return route.fulfill({
      status: range ? 206 : 200,
      contentType: "audio/wav",
      headers: {
        "accept-ranges": "bytes",
        ...(range ? { "content-range": `bytes ${first}-${last}/${wav.length}` } : {}),
      },
      body: wav.subarray(first, last + 1),
    });
  });
  await page.route("https://host.semlo.invalid/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}#audio-editor,#audio-second{max-width:800px;width:calc(100% - 24px);margin:32px auto}</style><div id="audio-editor"></div><div id="audio-second"></div>',
    }),
  );
  await page.goto("https://host.semlo.invalid/editor");
  await page.addStyleTag({ content: style });
  await page.addScriptTag({ content: bundle });
  await page.evaluate((options) => window.audioPlayerFixture.mount(options), options);
}
const card = (page: Page) => page.locator("#audio-editor .semlo-editor-media-audio");
const audio = (page: Page) => card(page).locator("audio");
const play = (page: Page) => card(page).getByRole("button", { name: "播放音频", exact: true });
const pause = (page: Page) => card(page).getByRole("button", { name: "暂停音频", exact: true });
const seek = (page: Page) => card(page).getByRole("slider", { name: "音频播放进度" });
const rate = (page: Page) => card(page).getByRole("combobox", { name: "音频播放速度" });
async function metadata(page: Page) {
  await expect.poll(() => audio(page).evaluate((element: HTMLAudioElement) => element.duration)).toBe(2);
  await expect
    .poll(() => audio(page).evaluate((element: HTMLAudioElement) => element.seekable.length && element.seekable.end(0)))
    .toBe(2);
}

test("public audio card exposes file information and six accessible playback rates", async ({ page }) => {
  await mount(page);
  await metadata(page);
  await expect(card(page)).toContainText("semlo-media-test.wav");
  await expect(card(page)).toContainText("64 kB");
  await expect(card(page).getByRole("link", { name: "下载音频" })).toHaveAttribute(
    "href",
    "https://audio.semlo.invalid/tone.wav",
  );
  await expect(play(page)).toBeVisible();
  await expect(seek(page)).toBeEnabled();
  await expect(rate(page).locator("option")).toHaveText(["2.0X", "1.5X", "1.25X", "1.0X", "0.75X", "0.5X"]);
  await expect(card(page).locator(".semlo-editor-audio-rate-display")).toHaveText("倍速");
  expect(await audio(page).evaluate((element: HTMLAudioElement) => element.controls)).toBe(false);
});

test("real WAV plays, pauses, seeks, completes and replays with the selected speed", async ({ page }) => {
  await mount(page);
  await metadata(page);
  await play(page).click();
  await expect.poll(() => audio(page).evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0);
  await pause(page).click();
  expect(await audio(page).evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  const bounds = (await seek(page).boundingBox())!;
  await page.mouse.click(bounds.x + bounds.width * 0.6, bounds.y + bounds.height / 2);
  await expect
    .poll(() => audio(page).evaluate((element: HTMLAudioElement) => element.currentTime))
    .toBeGreaterThan(0.8);
  for (const speed of [2, 1.5, 1.25, 1, 0.75, 0.5]) {
    await rate(page).selectOption(String(speed));
    expect(await audio(page).evaluate((element: HTMLAudioElement) => element.playbackRate)).toBe(speed);
  }
  await seek(page).focus();
  await page.keyboard.press("Home");
  await expect.poll(() => audio(page).evaluate((element: HTMLAudioElement) => element.currentTime)).toBe(0);
  await rate(page).selectOption("2");
  await expect(card(page).locator(".semlo-editor-audio-rate-display")).toHaveText("2.0X");
  await play(page).click();
  await expect.poll(() => audio(page).evaluate((element: HTMLAudioElement) => element.ended)).toBe(true);
  await expect(card(page).locator(".semlo-editor-audio-time").first()).toHaveText("00:02");
  await play(page).click();
  await expect.poll(() => audio(page).evaluate((element: HTMLAudioElement) => element.paused)).toBe(false);
  expect(await audio(page).evaluate((element: HTMLAudioElement) => element.playbackRate)).toBe(2);
  await pause(page).click();
});

test("keyboard controls work without editing the document and deletion has one undo", async ({ page }) => {
  await mount(page);
  await metadata(page);
  const before = await page.evaluate(() => window.audioPlayerFixture.api.getSnapshot());
  await play(page).focus();
  await page.keyboard.press("Space");
  await expect(pause(page)).toBeFocused();
  await page.keyboard.press("Space");
  await expect(play(page)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(seek(page)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  expect(await audio(page).evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0);
  await page.keyboard.press("Tab");
  await expect(rate(page)).toBeFocused();
  // 原生 select 的弹出导航由平台处理；键盘输入选项前缀并确认可直接验证实际倍速。
  await page.keyboard.type("0.75");
  await page.keyboard.press("Enter");
  expect(await audio(page).evaluate((element: HTMLAudioElement) => element.playbackRate)).toBe(0.75);
  expect(await page.evaluate(() => window.audioPlayerFixture.api.getSnapshot())).toEqual(before);
  expect(await page.evaluate(() => window.audioPlayerFixture.changes)).toBe(0);
  expect(await page.evaluate(() => window.audioPlayerFixture.api.editor.can().undo())).toBe(false);
  await page.keyboard.press("Tab");
  await expect(card(page).getByRole("link", { name: "下载音频" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(card(page).getByLabel("阅读页可下载")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(card(page).getByRole("button", { name: "删除音频" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(audio(page)).toHaveCount(0);
  await page.evaluate(() => window.audioPlayerFixture.api.editor.commands.undo());
  expect(await page.evaluate(() => window.audioPlayerFixture.api.getSnapshot())).toEqual(before);
  expect(await page.evaluate(() => window.audioPlayerFixture.api.editor.can().undo())).toBe(false);
});

test("audio download preference survives JSON and HTML and controls the readonly entry", async ({ page }) => {
  await mount(page);
  const checkbox = card(page).getByLabel("阅读页可下载");
  const initial = await page.evaluate(() => window.audioPlayerFixture.api.getSnapshot());
  expect(initial.json.content?.[1].attrs).not.toHaveProperty("allowDownload");
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  const enabled = await page.evaluate(() => window.audioPlayerFixture.api.getSnapshot());
  expect(enabled.json.content?.[1].attrs?.allowDownload).toBe(true);
  expect(enabled.html).toContain('data-semlo-editor-allow-download="true"');
  await page.evaluate(() => window.audioPlayerFixture.api.setEditable(false));
  await expect(card(page).getByRole("link", { name: "下载音频" })).toBeVisible();
  await page.evaluate(() => window.audioPlayerFixture.api.setEditable(true));
  await checkbox.uncheck();
  const disabled = await page.evaluate(() => window.audioPlayerFixture.api.getSnapshot());
  expect(disabled.json.content?.[1].attrs?.allowDownload).toBe(false);
  expect(disabled.html).toContain('controlslist="nodownload"');
  await page.evaluate(() => window.audioPlayerFixture.api.setEditable(false));
  await expect(card(page).getByRole("link", { name: "下载音频" })).toHaveCount(0);
  await page.evaluate(() => window.audioPlayerFixture.api.setEditable(true));
  expect(await page.evaluate(() => window.audioPlayerFixture.api.editor.commands.undo())).toBe(true);
  await expect(checkbox).toBeChecked();
  await page.evaluate(
    ({ initial, disabled, enabled }) => {
      const editor = window.audioPlayerFixture.api;
      editor.setContent(initial);
      editor.setContent(disabled);
      if (editor.getSnapshot().json.content?.[1].attrs?.allowDownload !== false) throw new Error("下载设置未恢复");
      editor.setContent(enabled);
    },
    { initial: initial.json, disabled: disabled.html, enabled: enabled.html },
  );
  expect(
    (await page.evaluate(() => window.audioPlayerFixture.api.getSnapshot())).json.content?.[1].attrs?.allowDownload,
  ).toBe(true);
});

test("touch playback and progress stay usable on a narrow card with a long file name", async ({ page }) => {
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
    await mobile.evaluate(() =>
      window.audioPlayerFixture.setAttrs({ name: "这是一段需要完整保留但不能撑破播放器的长文件名.wav" }),
    );
    await metadata(mobile);
    const button = (await play(mobile).boundingBox())!;
    expect(button.width).toBeGreaterThanOrEqual(44);
    await mobile.touchscreen.tap(button.x + button.width / 2, button.y + button.height / 2);
    await expect
      .poll(() => audio(mobile).evaluate((element: HTMLAudioElement) => element.currentTime))
      .toBeGreaterThan(0);
    const pauseBounds = (await pause(mobile).boundingBox())!;
    await mobile.touchscreen.tap(pauseBounds.x + pauseBounds.width / 2, pauseBounds.y + pauseBounds.height / 2);
    const slider = (await seek(mobile).boundingBox())!;
    await mobile.touchscreen.tap(slider.x + slider.width * 0.7, slider.y + slider.height / 2);
    await expect
      .poll(() => audio(mobile).evaluate((element: HTMLAudioElement) => element.currentTime))
      .toBeGreaterThan(0.8);
    await rate(mobile).selectOption("1.5");
    expect(await audio(mobile).evaluate((element: HTMLAudioElement) => element.playbackRate)).toBe(1.5);
    const overflow = await card(mobile).evaluate((element) => ({
      width: element.clientWidth,
      scroll: element.scrollWidth,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.width + 1);
    for (const element of [play(mobile), seek(mobile), rate(mobile)]) {
      const rect = (await element.boundingBox())!;
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(360);
    }
  } finally {
    await context.close();
  }
});

test("read-only can play, seek and change speed while keeping history and content untouched", async ({ page }) => {
  await mount(page, { editable: false });
  await metadata(page);
  const before = await page.evaluate(() => window.audioPlayerFixture.api.getSnapshot());
  await expect(card(page).getByRole("button", { name: "删除音频", includeHidden: true })).toBeHidden();
  await play(page).click();
  await expect.poll(() => audio(page).evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0);
  await rate(page).selectOption("0.5");
  await page.evaluate(() => window.audioPlayerFixture.api.setEditable(true));
  await expect(card(page).getByRole("button", { name: "删除音频" })).toBeVisible();
  await page.evaluate(() => window.audioPlayerFixture.api.setEditable(false));
  expect(await audio(page).evaluate((element: HTMLAudioElement) => element.paused)).toBe(false);
  await pause(page).click();
  await seek(page).focus();
  await page.keyboard.press("End");
  expect(await audio(page).evaluate((element: HTMLAudioElement) => element.currentTime)).toBe(2);
  expect(await page.evaluate(() => window.audioPlayerFixture.api.getSnapshot())).toEqual(before);
  expect(await page.evaluate(() => window.audioPlayerFixture.changes)).toBe(0);
  expect(await page.evaluate(() => window.audioPlayerFixture.api.editor.can().undo())).toBe(false);
});

for (const echo of ["json", "html"] as const) {
  test(`${echo} controlled echo preserves audio attributes and export while playback stays outside history`, async ({
    page,
  }) => {
    await mount(page, { echo });
    const original = await page.evaluate(() => window.audioPlayerFixture.api.getSnapshot());
    expect(original.html).toContain('<audio src="https://audio.semlo.invalid/tone.wav" controls="" preload="metadata"');
    expect(original.html).not.toMatch(/semlo-editor-audio-(player|toggle|progress|rate)|playbackRate/);
    await page.evaluate(() => window.audioPlayerFixture.setAttrs({ name: "重命名.wav" }));
    await metadata(page);
    const renamed = await page.evaluate(() => window.audioPlayerFixture.api.getSnapshot());
    const changes = await page.evaluate(() => window.audioPlayerFixture.changes);
    await rate(page).selectOption("2");
    await play(page).click();
    try {
      await expect
        .poll(() => audio(page).evaluate((element: HTMLAudioElement) => element.currentTime))
        .toBeGreaterThan(0);
    } catch (error) {
      // 失败时记录真实媒体与控件状态，区分点击、资源和受控回写问题。
      console.log(
        "audio-controlled-playback-diagnostic",
        await page.evaluate(() => {
          const element = document.querySelector<HTMLAudioElement>("#audio-editor audio")!;
          const button = document.querySelector<HTMLButtonElement>("#audio-editor .semlo-editor-audio-toggle");
          return {
            ready: element.readyState,
            network: element.networkState,
            paused: element.paused,
            ended: element.ended,
            time: element.currentTime,
            duration: element.duration,
            rate: element.playbackRate,
            error: element.error ? { code: element.error.code, message: element.error.message } : null,
            seekable: Array.from({ length: element.seekable.length }, (_, i) => [
              element.seekable.start(i),
              element.seekable.end(i),
            ]),
            connected: element.isConnected,
            toggle: button?.getAttribute("aria-label"),
            disabled: button?.disabled,
            status: document.querySelector("#audio-editor .semlo-editor-audio-status")?.textContent,
            changes: window.audioPlayerFixture.changes,
            focus: document.hasFocus(),
            visibility: document.visibilityState,
          };
        }),
      );
      throw error;
    }
    await pause(page).click();
    await seek(page).focus();
    await page.keyboard.press("End");
    expect(await page.evaluate(() => window.audioPlayerFixture.api.getSnapshot())).toEqual(renamed);
    expect(await page.evaluate(() => window.audioPlayerFixture.changes)).toBe(changes);
    await page.evaluate(() => window.audioPlayerFixture.api.editor.commands.undo());
    expect(await page.evaluate(() => window.audioPlayerFixture.api.getSnapshot())).toEqual(original);
    await page.evaluate(() => window.audioPlayerFixture.api.editor.commands.redo());
    expect(await page.evaluate(() => window.audioPlayerFixture.api.getSnapshot())).toEqual(renamed);
    await card(page).getByRole("button", { name: "删除音频" }).click();
    await expect(audio(page)).toHaveCount(0);
    await page.evaluate(() => window.audioPlayerFixture.api.editor.commands.undo());
    expect(await page.evaluate(() => window.audioPlayerFixture.api.getSnapshot())).toEqual(renamed);
    await page.evaluate((html) => window.audioPlayerFixture.api.setContent(html), renamed.html);
    expect(await page.evaluate(() => window.audioPlayerFixture.api.getSnapshot())).toEqual(renamed);
    await page.evaluate((json) => window.audioPlayerFixture.mount({ content: json }), renamed.json);
    expect(await page.evaluate(() => window.audioPlayerFixture.api.getSnapshot())).toEqual(renamed);
    await expect(page.locator("#audio-editor .ProseMirror")).toContainText("音频之前");
    await expect(page.locator("#audio-editor .ProseMirror")).toContainText("音频之后");
  });
}

test("unsafe legacy source remains round-trippable but disabled, then a safe source can play", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => window.audioPlayerFixture.setAttrs({ src: "javascript:alert(1)" }));
  const unsafe = await page.evaluate(() => window.audioPlayerFixture.api.getSnapshot());
  await expect(audio(page)).not.toHaveAttribute("src");
  await expect(play(page)).toBeDisabled();
  await expect(seek(page)).toBeDisabled();
  await expect(card(page).getByRole("status")).toContainText("音频地址无效");
  expect(unsafe.json.content![1].attrs!.src).toBe("javascript:alert(1)");
  await page.evaluate((html) => window.audioPlayerFixture.mount({ content: html }), unsafe.html);
  expect(await page.evaluate(() => window.audioPlayerFixture.api.getSnapshot())).toEqual(unsafe);
  await expect(audio(page)).not.toHaveAttribute("src");
  await page.evaluate(() => window.audioPlayerFixture.setAttrs({ src: "https://audio.semlo.invalid/tone.wav" }));
  await metadata(page);
  await play(page).click();
  await expect.poll(() => audio(page).evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0);
  await pause(page).click();
});

test("metadata-only updates keep playback, source updates release old audio and reset runtime settings", async ({
  page,
}) => {
  await mount(page);
  await metadata(page);
  await rate(page).selectOption("2");
  await page.evaluate(() => {
    window.audioPlayerFixture.retained = document.querySelector<HTMLAudioElement>("#audio-editor audio")!;
    window.audioPlayerFixture.retained.currentTime = 0.5;
    window.audioPlayerFixture.setAttrs({ name: "更新名称.wav", size: 1200 });
  });
  expect(
    await page.evaluate(() => document.querySelector("#audio-editor audio") === window.audioPlayerFixture.retained),
  ).toBe(true);
  expect(await audio(page).evaluate((element: HTMLAudioElement) => element.currentTime)).toBe(0.5);
  await expect(rate(page)).toHaveValue("2");
  await play(page).click();
  await expect.poll(() => audio(page).evaluate((element: HTMLAudioElement) => element.paused)).toBe(false);
  await page.evaluate(() => window.audioPlayerFixture.setAttrs({ src: "https://audio.semlo.invalid/second.wav" }));
  await metadata(page);
  expect(
    await page.evaluate(() => ({
      paused: window.audioPlayerFixture.retained!.paused,
      source: window.audioPlayerFixture.retained!.getAttribute("src"),
      connected: window.audioPlayerFixture.retained!.isConnected,
    })),
  ).toEqual({ paused: true, source: null, connected: false });
  expect(await audio(page).evaluate((element: HTMLAudioElement) => element.currentTime)).toBe(0);
  await expect(rate(page)).toHaveValue("1");
  await expect(play(page)).toBeVisible();
  await expect(card(page)).toContainText("更新名称.wav");
});

test("simulated rejected and throwing play calls are contained and real playback can recover", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mount(page);
  await metadata(page);
  for (const kind of ["reject", "throw"] as const) {
    await audio(page).evaluate((element: HTMLAudioElement, kind) => {
      element.play = () => {
        if (kind === "throw") throw new Error("模拟同步播放失败");
        return Promise.reject(new DOMException("模拟播放被拒绝", "NotAllowedError"));
      };
    }, kind);
    await play(page).click();
    await expect(card(page).getByRole("status")).toContainText("音频无法播放");
    await expect(play(page)).toBeEnabled();
  }
  await audio(page).evaluate((element: HTMLAudioElement) => {
    delete (element as { play?: () => Promise<void> }).play;
  });
  await play(page).click();
  await expect.poll(() => audio(page).evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0);
  await expect(card(page).getByRole("status")).toBeHidden();
  await pause(page).click();
  expect(errors).toEqual([]);
});

async function deferredPlay(page: Page) {
  await audio(page).evaluate((element: HTMLAudioElement) => {
    window.audioPlayerFixture.retained = element;
    element.play = () =>
      new Promise<void>((resolve, reject) => {
        window.audioPlayerFixture.settlePlay = resolve;
        window.audioPlayerFixture.rejectPlay = () => reject(new DOMException("模拟迟到拒绝", "AbortError"));
      });
  });
  await play(page).click();
  await expect(pause(page)).toBeVisible();
}

test("a simulated late play result cannot resume a cancelled request or pause a newer real play", async ({ page }) => {
  await mount(page);
  await metadata(page);
  const before = await page.evaluate(() => window.audioPlayerFixture.api.getSnapshot());
  await deferredPlay(page);
  await pause(page).click();
  await page.evaluate(() => window.audioPlayerFixture.settlePlay!());
  await expect(play(page)).toBeVisible();
  expect(await audio(page).evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  await deferredPlay(page);
  await pause(page).click();
  await audio(page).evaluate((element: HTMLAudioElement) => {
    delete (element as { play?: () => Promise<void> }).play;
  });
  await play(page).click();
  await expect.poll(() => audio(page).evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0);
  await page.evaluate(() => window.audioPlayerFixture.settlePlay!());
  expect(await audio(page).evaluate((element: HTMLAudioElement) => element.paused)).toBe(false);
  await pause(page).click();
  expect(await page.evaluate(() => window.audioPlayerFixture.api.getSnapshot())).toEqual(before);
});

test("document replacement invalidates an old simulated play request even with the same audio attributes", async ({
  page,
}) => {
  await mount(page);
  await metadata(page);
  await rate(page).selectOption("2");
  await deferredPlay(page);
  await page.evaluate(() => {
    const json = window.audioPlayerFixture.api.getSnapshot().json;
    json.content![0].content![0].text = "替换后的前文";
    window.audioPlayerFixture.api.setContent(json);
  });
  await metadata(page);
  await page.evaluate(() => window.audioPlayerFixture.rejectPlay!());
  expect(await page.evaluate(() => window.audioPlayerFixture.retained!.getAttribute("src"))).toBeNull();
  expect(
    await page.evaluate(() => document.querySelector("#audio-editor audio") === window.audioPlayerFixture.retained),
  ).toBe(false);
  await expect(play(page)).toBeVisible();
  await expect(rate(page)).toHaveValue("1");
  await expect(card(page).getByRole("status")).toBeHidden();
  await play(page).click();
  await expect.poll(() => audio(page).evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0);
  await pause(page).click();
});

test("unmount removes media listeners and stale controls while remount creates a fresh playable node", async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(() => {
    window.audioPlayerFixture.api.destroy();
    const added = EventTarget.prototype.addEventListener;
    const removed = EventTarget.prototype.removeEventListener;
    const ledger = { added: 0, removed: 0 };
    (window as unknown as { audioListeners: typeof ledger }).audioListeners = ledger;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (this instanceof HTMLAudioElement) ledger.added += 1;
      return added.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      if (this instanceof HTMLAudioElement) ledger.removed += 1;
      return removed.call(this, type, listener, options);
    };
    window.audioPlayerFixture.mount();
  });
  await metadata(page);
  await deferredPlay(page);
  const button = await pause(page).elementHandle();
  await page.evaluate(() => window.audioPlayerFixture.api.editor.unmount());
  await page.evaluate(() => window.audioPlayerFixture.settlePlay!());
  expect(
    await page.evaluate(() => {
      const ledger = (window as unknown as { audioListeners: { added: number; removed: number } }).audioListeners;
      return { ...ledger, source: window.audioPlayerFixture.retained!.getAttribute("src") };
    }),
  ).toEqual({ added: 9, removed: 9, source: null });
  await button!.evaluate((element) => (element as HTMLButtonElement).click());
  await page.evaluate(() => {
    const editor = window.audioPlayerFixture.api.editor;
    editor.mount(editor.options.element as HTMLElement);
  });
  await metadata(page);
  await expect(play(page)).toBeVisible();
  await play(page).click();
  await expect.poll(() => audio(page).evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0);
  await pause(page).click();
});

test("destroyed playback ignores a simulated late rejection and does not affect a second real player", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mount(page);
  await page.evaluate(() => window.audioPlayerFixture.mountSecond());
  const other = page.locator("#audio-second .semlo-editor-audio-player");
  await expect.poll(() => other.locator("audio").evaluate((element: HTMLAudioElement) => element.duration)).toBe(2);
  await other.getByRole("combobox", { name: "音频播放速度" }).selectOption("0.5");
  await other.getByRole("button", { name: "播放音频", exact: true }).click();
  await expect
    .poll(() => other.locator("audio").evaluate((element: HTMLAudioElement) => element.currentTime))
    .toBeGreaterThan(0);
  await deferredPlay(page);
  await page.evaluate(() => window.audioPlayerFixture.api.destroy());
  await page.evaluate(() => window.audioPlayerFixture.rejectPlay!());
  await expect(card(page)).toHaveCount(0);
  expect(
    await page.evaluate(() => ({
      paused: window.audioPlayerFixture.retained!.paused,
      source: window.audioPlayerFixture.retained!.getAttribute("src"),
    })),
  ).toEqual({ paused: true, source: null });
  expect(await other.locator("audio").evaluate((element: HTMLAudioElement) => element.paused)).toBe(false);
  expect(await other.locator("audio").evaluate((element: HTMLAudioElement) => element.playbackRate)).toBe(0.5);
  await other.getByRole("button", { name: "暂停音频", exact: true }).click();
  expect(errors).toEqual([]);
});
