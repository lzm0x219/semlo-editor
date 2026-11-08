import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import type {} from "../../fixtures/toolbar/custom-floating-toolbar-fixture";

declare global {
  interface Window {
    bubbleScrollTracking: { mark: () => void; count: () => number };
  }
}

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: {
        entry: { index: "./tests/fixtures/toolbar/custom-floating-toolbar-fixture.ts" },
        define: {
          "process.env.NODE_ENV": JSON.stringify("development"),
          __VUE_OPTIONS_API__: true,
          __VUE_PROD_DEVTOOLS__: false,
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
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
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.floatingToolbarFixture));
});

for (const main of ["default", "custom"] as const) {
  for (const floating of ["default", "custom"] as const) {
    test(`${main} 主工具栏与 ${floating} 浮动工具栏在顶部选区不重叠`, async ({ page }) => {
      await page.evaluate(
        ({ main, floating }) => {
          window.floatingToolbarFixture.mount("core", "A", main, floating);
          const host = document.querySelector<HTMLElement>("#floating-host-A")!;
          host.style.marginTop = "100px";
          const toolbar = host.querySelector<HTMLElement>(".semlo-editor-toolbar, .semlo-editor-custom-toolbar")!;
          if (main === "custom") toolbar.style.cssText = "height:44px;background:white";
          host.querySelector<HTMLElement>(".semlo-editor-content")!.style.padding = "8px 20px 120px";
          window.floatingToolbarFixture.select("A");
        },
        { main, floating },
      );
      const host = page.locator("#floating-host-A");
      const bubble = host.getByRole("toolbar", { name: "选中文字工具" });
      await expect(bubble).toBeVisible();
      await expect
        .poll(() =>
          host.evaluate((element) => {
            const main = element
              .querySelector(".semlo-editor-toolbar, .semlo-editor-custom-toolbar")!
              .getBoundingClientRect();
            const bubble = element.querySelector(".semlo-editor-bubble")!.getBoundingClientRect();
            return (
              bubble.top >= main.bottom ||
              bubble.bottom <= main.top ||
              bubble.right <= main.left ||
              bubble.left >= main.right
            );
          }),
        )
        .toBe(true);
      expect(await page.evaluate(() => window.floatingToolbarFixture.selection("A"))).toEqual({ from: 1, to: 12 });
      if (floating === "custom") await bubble.getByRole("button", { name: "自定义加粗 A", exact: true }).click();
      else {
        await expect(bubble.getByRole("button")).toHaveCount(1);
        await expect(bubble.getByRole("button", { name: "AI 写作", exact: true })).toBeDisabled();
        await expect(host.locator(".semlo-editor-prose")).toHaveText("hello world");
        // 默认浮层只有 AI；格式与历史仍通过编辑器快捷键验证。
        await page.keyboard.press("ControlOrMeta+b");
      }
      await expect(host.locator(".semlo-editor-prose strong")).toHaveText("hello world");
      await page.evaluate(() => window.floatingToolbarFixture.undo("A"));
      await expect(host.locator(".semlo-editor-prose strong")).toHaveCount(0);
      await page.evaluate(() => window.floatingToolbarFixture.redo("A"));
      await expect(host.locator(".semlo-editor-prose strong")).toHaveText("hello world");
      await page.evaluate(() => window.floatingToolbarFixture.destroy("A"));
    });
  }
}

test("没有主工具栏时保留浮动工具栏在选区上方的默认定位", async ({ page }) => {
  await page.evaluate(() => {
    window.floatingToolbarFixture.mount("core", "A", "hidden", "custom");
    const host = document.querySelector<HTMLElement>("#floating-host-A")!;
    host.style.marginTop = "120px";
    window.floatingToolbarFixture.select("A");
  });
  const host = page.locator("#floating-host-A");
  const bubble = host.getByRole("toolbar", { name: "选中文字工具" });
  await expect(bubble).toBeVisible();
  await expect
    .poll(() =>
      host.evaluate((element) => {
        const bubble = element.querySelector(".semlo-editor-bubble")!.getBoundingClientRect();
        const paragraph = element.querySelector(".semlo-editor-prose p")!.getBoundingClientRect();
        return bubble.bottom <= paragraph.top;
      }),
    )
    .toBe(true);
  await page.evaluate(() => window.floatingToolbarFixture.destroy("A"));
});

test("主工具栏与选区在水平方向分离时保留上方定位", async ({ page }) => {
  await page.evaluate(() => {
    window.floatingToolbarFixture.mount("core", "A", "custom", "custom");
    const host = document.querySelector<HTMLElement>("#floating-host-A")!;
    host.style.cssText = "width:600px;margin-top:100px";
    host.querySelector<HTMLElement>(".semlo-editor-custom-toolbar")!.style.cssText = "width:80px;height:44px";
    host.querySelector<HTMLElement>(".semlo-editor-content")!.style.padding = "8px 20px 120px";
    const style = document.createElement("style");
    style.textContent = "#floating-host-A .semlo-editor-prose p { text-align: right !important; }";
    document.head.append(style);
    window.floatingToolbarFixture.select("A");
  });
  const host = page.locator("#floating-host-A");
  await expect(host.getByRole("toolbar", { name: "选中文字工具" })).toBeVisible();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const bounds = await host.evaluate((element) => {
    const main = element.querySelector(".semlo-editor-custom-toolbar")!.getBoundingClientRect();
    const bubble = element.querySelector(".semlo-editor-bubble")!.getBoundingClientRect();
    const paragraph = element.querySelector(".semlo-editor-prose p")!.getBoundingClientRect();
    return {
      main: main.toJSON(),
      bubble: bubble.toJSON(),
      paragraph: paragraph.toJSON(),
      range: element.ownerDocument.getSelection()!.getRangeAt(0).getBoundingClientRect().toJSON(),
    };
  });
  expect(bounds.bubble.left, JSON.stringify(bounds)).toBeGreaterThanOrEqual(bounds.main.right);
  expect(bounds.bubble.top, JSON.stringify(bounds)).toBeLessThan(bounds.main.bottom);
  expect(bounds.bubble.bottom, JSON.stringify(bounds)).toBeLessThanOrEqual(bounds.paragraph.top);
  await page.evaluate(() => window.floatingToolbarFixture.destroy("A"));
});

test("上下空间不足时浮动工具栏移到主工具栏旁边", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 170 });
  await page.evaluate(() => {
    window.floatingToolbarFixture.mount("core", "A", "custom", "default");
    const host = document.querySelector<HTMLElement>("#floating-host-A")!;
    host.style.cssText = "position:relative;width:350px;margin-top:20px";
    host.querySelector<HTMLElement>(".semlo-editor-custom-toolbar")!.style.cssText =
      "position:absolute;top:0;left:0;width:60px;height:130px;background:white;z-index:10";
    host.querySelector<HTMLElement>(".semlo-editor-content")!.style.padding = "8px 20px 120px";
    window.floatingToolbarFixture.select("A");
  });
  const host = page.locator("#floating-host-A");
  const bubble = host.getByRole("toolbar", { name: "选中文字工具" });
  await expect(bubble).toBeVisible();
  await expect
    .poll(() =>
      host.evaluate((element) => {
        const main = element.querySelector(".semlo-editor-custom-toolbar")!.getBoundingClientRect();
        const floating = element.querySelector(".semlo-editor-bubble")!.getBoundingClientRect();
        return floating.left >= main.right && floating.right <= window.innerWidth;
      }),
    )
    .toBe(true);
  await expect(bubble.getByRole("button")).toHaveCount(1);
  await expect(bubble.getByRole("button", { name: "AI 写作", exact: true })).toBeDisabled();
  await expect(host.locator(".semlo-editor-prose")).toHaveText("hello world");
  await page.evaluate(() => window.floatingToolbarFixture.destroy("A"));
});

test("容器滚动后浮动工具栏继续避让当前实例的吸顶主工具栏", async ({ page }) => {
  await page.evaluate(() => {
    window.floatingToolbarFixture.mount("core", "A", "custom", "custom");
    const host = document.querySelector<HTMLElement>("#floating-host-A")!;
    const main = host.querySelector<HTMLElement>(".semlo-editor-custom-toolbar")!;
    const content = host.querySelector<HTMLElement>(".semlo-editor-content")!;
    host.style.cssText = "position:relative;height:300px;overflow:auto;margin-top:100px";
    main.style.cssText = "position:sticky;top:0;height:44px;z-index:10;background:white";
    content.style.padding = "120px 20px 1000px";
    window.floatingToolbarFixture.select("A");
  });
  const host = page.locator("#floating-host-A");
  const bubble = host.getByRole("toolbar", { name: "选中文字工具" });
  await expect(bubble).toBeVisible();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const selection = await page.evaluate(() => window.floatingToolbarFixture.selection("A"));
  await host.evaluate((element) => (element.scrollTop = 80));
  await expect
    .poll(async () =>
      host.evaluate((element) => {
        const main = element.querySelector(".semlo-editor-custom-toolbar")!.getBoundingClientRect();
        const bubble = element.querySelector(".semlo-editor-bubble")!.getBoundingClientRect();
        return (
          bubble.top >= main.bottom ||
          bubble.bottom <= main.top ||
          bubble.right <= main.left ||
          bubble.left >= main.right
        );
      }),
    )
    .toBe(true);
  expect(await page.evaluate(() => window.floatingToolbarFixture.selection("A"))).toEqual(selection);
  await bubble.getByRole("button", { name: "自定义加粗 A" }).click();
  await expect(host.locator(".semlo-editor-prose strong")).toHaveText("hello world");
  await page.evaluate(() => window.floatingToolbarFixture.destroy("A"));
});

test("页面滚动后浮动工具栏继续避让吸顶主工具栏", async ({ page }) => {
  await page.evaluate(() => {
    window.floatingToolbarFixture.mount("core", "A", "custom", "custom");
    const host = document.querySelector<HTMLElement>("#floating-host-A")!;
    host.style.marginTop = "100px";
    host.querySelector<HTMLElement>(".semlo-editor-custom-toolbar")!.style.cssText =
      "position:sticky;top:0;height:44px;z-index:10;background:white";
    host.querySelector<HTMLElement>(".semlo-editor-content")!.style.padding = "120px 20px 1000px";
    window.floatingToolbarFixture.select("A");
  });
  const host = page.locator("#floating-host-A");
  const bubble = host.getByRole("toolbar", { name: "选中文字工具" });
  await expect(bubble).toBeVisible();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => window.scrollTo(0, 200));
  await expect
    .poll(() =>
      host.evaluate((element) => {
        const main = element.querySelector(".semlo-editor-custom-toolbar")!.getBoundingClientRect();
        const bubble = element.querySelector(".semlo-editor-bubble")!.getBoundingClientRect();
        return (
          bubble.top >= main.bottom ||
          bubble.bottom <= main.top ||
          bubble.right <= main.left ||
          bubble.left >= main.right
        );
      }),
    )
    .toBe(true);
  expect(await page.evaluate(() => window.floatingToolbarFixture.selection("A"))).toEqual({ from: 1, to: 12 });
  await bubble.getByRole("button", { name: "自定义加粗 A" }).click();
  await expect(host.locator(".semlo-editor-prose strong")).toHaveText("hello world");
  await page.evaluate(() => window.floatingToolbarFixture.destroy("A"));
});

test("滚动监听随浮动工具栏隐藏和实例销毁清理，重挂载后恢复", async ({ page }) => {
  await page.evaluate(() => {
    const add = document.addEventListener;
    const remove = document.removeEventListener;
    const handlers = new Set<EventListenerOrEventListenerObject>();
    document.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (type === "scroll" && options === true) handlers.add(listener);
      add.call(document, type, listener, options);
    }) as typeof document.addEventListener;
    document.removeEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) => {
      if (type === "scroll" && options === true) handlers.delete(listener);
      remove.call(document, type, listener, options);
    }) as typeof document.removeEventListener;
    let previous = new Set(handlers);
    window.bubbleScrollTracking = {
      mark: () => {
        previous = new Set(handlers);
      },
      count: () => [...handlers].filter((handler) => !previous.has(handler)).length,
    };
    window.floatingToolbarFixture.mount("core", "A", "custom", "custom");
    window.floatingToolbarFixture.mount("core", "B", "custom", "custom");
    window.bubbleScrollTracking.mark();
    window.floatingToolbarFixture.select("A");
  });
  const count = () => page.evaluate(() => window.bubbleScrollTracking.count());
  await expect(page.locator("#floating-host-A").getByRole("toolbar", { name: "选中文字工具" })).toBeVisible();
  expect(await count()).toBe(1);
  await page.evaluate(() => window.floatingToolbarFixture.collapse("A"));
  expect(await count()).toBe(0);
  await page.evaluate(() => window.floatingToolbarFixture.select("A"));
  await expect(page.locator("#floating-host-A").getByRole("toolbar", { name: "选中文字工具" })).toBeVisible();
  expect(await count()).toBe(1);
  await page.evaluate(() => window.floatingToolbarFixture.destroy("A"));
  expect(await count()).toBe(0);
  await page.evaluate(() => {
    window.floatingToolbarFixture.remount("B");
    window.bubbleScrollTracking.mark();
    window.floatingToolbarFixture.select("B");
  });
  await expect(page.locator("#floating-host-B").getByRole("toolbar", { name: "选中文字工具" })).toBeVisible();
  expect(await count()).toBe(1);
  await page.evaluate(() => window.floatingToolbarFixture.destroy("B"));
  expect(await count()).toBe(0);
});

for (const kind of ["core", "react", "vue", "solid"]) {
  test(`${kind} 通过公开接口替换浮动工具栏并保留编辑和链接`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.evaluate((kind) => window.floatingToolbarFixture.mount(kind, "A"), kind);
    const host = page.locator("#floating-host-A");
    const editor = host.locator(".semlo-editor-prose");
    const main = host.getByRole("toolbar", { name: "文本格式" });
    await expect(editor).toBeVisible();
    await expect(main.getByRole("button", { name: "加粗", exact: true })).toBeVisible();
    await page.evaluate(() => window.floatingToolbarFixture.select("A"));
    const floating = host.getByRole("toolbar", { name: "选中文字工具" });
    const bold = floating.getByRole("button", { name: "自定义加粗 A" });
    await expect(floating).toBeVisible();
    await expect(floating.getByRole("button", { name: "加粗", exact: true })).toHaveCount(0);
    await bold.click();
    await expect(editor.locator("strong")).toHaveText("hello world");
    await expect(bold).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() => window.floatingToolbarFixture.undo("A"));
    await expect(editor.locator("strong")).toHaveCount(0);
    await page.evaluate(() => window.floatingToolbarFixture.redo("A"));
    await expect(editor.locator("strong")).toHaveText("hello world");
    await main.getByRole("button", { name: "斜体", exact: true }).click();
    await expect(editor.locator("em")).toHaveText("hello world");
    await expect(floating.getByRole("button", { name: "自定义斜体 A" })).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() => window.floatingToolbarFixture.editable("A", false));
    await expect(bold).toBeDisabled();
    await expect(editor).toHaveAttribute("aria-readonly", "true");
    await page.evaluate(() => window.floatingToolbarFixture.editable("A", true));
    await page.evaluate(() => window.floatingToolbarFixture.select("A"));
    await expect(bold).toBeEnabled();
    await floating.getByRole("button", { name: "自定义链接 A" }).click();
    const link = page.getByRole("dialog", { name: "插入链接" });
    await expect(link.getByLabel("文本")).toHaveValue("hello world");
    await link.getByLabel("链接", { exact: true }).fill("https://example.com");
    await link.getByRole("button", { name: "确定" }).click();
    await expect(editor.locator("a")).toHaveAttribute("href", "https://example.com");
    await expect(editor.locator("a strong")).toHaveText("hello world");
    await expect(host.locator("[floatingtoolbar]")).toHaveCount(0);
    await page.evaluate(() => window.floatingToolbarFixture.destroy("A"));
    expect(await page.evaluate(() => window.floatingToolbarFixture.cleanupCount("A"))).toBe(1);
    expect(errors).toEqual([]);
  });

  test(`${kind} 默认 AI、显式开关与继承，并在服务可用时保留选区打开助手`, async ({ page }) => {
    await page.evaluate((kind) => window.floatingToolbarFixture.mount(kind, "A", "hidden", "default"), kind);
    let host = page.locator("#floating-host-A");
    await host.locator(".semlo-editor-prose").focus();
    await page.evaluate(() => window.floatingToolbarFixture.select("A"));
    const tools = host.getByRole("toolbar", { name: "选中文字工具" });
    await expect(tools).toBeVisible();
    await expect(tools.getByRole("button")).toHaveCount(1);
    await expect(tools.getByRole("button", { name: "AI 写作", exact: true })).toBeDisabled();
    expect(await page.evaluate(() => window.floatingToolbarFixture.selection("A"))).toEqual({ from: 1, to: 12 });
    await expect(host.locator(".semlo-editor-prose")).toHaveText("hello world");
    await page.evaluate(() => window.floatingToolbarFixture.destroy("A"));

    await page.evaluate((kind) => window.floatingToolbarFixture.mount(kind, "B", "default", "hidden"), kind);
    host = page.locator("#floating-host-B");
    await host.locator(".semlo-editor-prose").focus();
    await page.evaluate(() => window.floatingToolbarFixture.select("B"));
    await expect(host.getByRole("toolbar", { name: "文本格式" })).toBeVisible();
    await expect(host.locator(".semlo-editor-bubble")).toHaveCount(0);
    await page.evaluate(() => window.floatingToolbarFixture.destroy("B"));

    await page.evaluate((kind) => window.floatingToolbarFixture.mount(kind, "C", "hidden", "inherit"), kind);
    host = page.locator("#floating-host-C");
    await host.locator(".semlo-editor-prose").focus();
    await page.evaluate(() => window.floatingToolbarFixture.select("C"));
    await expect(host.locator(".semlo-editor-bubble")).toHaveCount(0);
    await page.evaluate(() => window.floatingToolbarFixture.destroy("C"));

    await page.evaluate(
      (kind) => window.floatingToolbarFixture.mount(kind, "D", "default", "default", false, true),
      kind,
    );
    host = page.locator("#floating-host-D");
    await host.locator(".semlo-editor-prose").focus();
    await page.evaluate(() => window.floatingToolbarFixture.select("D"));
    const ai = host
      .getByRole("toolbar", { name: "选中文字工具" })
      .getByRole("button", { name: "AI 写作", exact: true });
    await expect(ai).toBeEnabled();
    await ai.click();
    await expect(host.getByLabel("向智能助手提问", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.floatingToolbarFixture.selection("D"))).toEqual({ from: 1, to: 12 });
    await expect(host.locator(".semlo-editor-prose > p")).toHaveText("hello world");
    await host.getByRole("button", { name: "关闭写作助手" }).click();
    await expect(host.locator(".semlo-editor-prose")).toHaveText("hello world");
    await page.evaluate(() => window.floatingToolbarFixture.destroy("D"));
  });

  test(`${kind} 自定义浮动工具栏在受控回写后保留选区和撤销`, async ({ page }) => {
    await page.evaluate((kind) => window.floatingToolbarFixture.mount(kind, "A", "hidden", "custom", true), kind);
    const editor = page.locator("#floating-host-A .semlo-editor-prose");
    await editor.focus();
    await page.evaluate(() => window.floatingToolbarFixture.select("A"));
    await page.getByRole("button", { name: "自定义加粗 A" }).click();
    await page.waitForFunction(() => window.floatingToolbarFixture.echoCount("A") >= 1);
    await expect(editor.locator("strong")).toHaveText("hello world");
    expect(await page.evaluate(() => window.floatingToolbarFixture.selection("A"))).toEqual({ from: 1, to: 12 });
    await page.evaluate(() => window.floatingToolbarFixture.undo("A"));
    await expect(editor.locator("strong")).toHaveCount(0);
    await page.evaluate(() => window.floatingToolbarFixture.redo("A"));
    await expect(editor.locator("strong")).toHaveText("hello world");
    await page.evaluate(() => window.floatingToolbarFixture.select("A"));
    await page.getByRole("button", { name: "自定义斜体 A" }).click();
    await expect(editor.locator("strong em")).toHaveText("hello world");
    await page.evaluate(() => window.floatingToolbarFixture.destroy("A"));
  });

  test(`${kind} 自定义浮动工具栏遵守标题与正文的加粗规则`, async ({ page }) => {
    await page.evaluate((kind) => window.floatingToolbarFixture.mount(kind, "A"), kind);
    const host = page.locator("#floating-host-A");
    const editor = host.locator(".semlo-editor-prose");
    await expect(editor).toBeVisible();
    await page.evaluate(() => window.floatingToolbarFixture.setContent("A", "<h2>title</h2><p>plain</p>"));
    await editor.focus();
    await page.evaluate(() => window.floatingToolbarFixture.selectRange("A", 1, 13));
    const bold = host.getByRole("button", { name: "自定义加粗 A" });
    await bold.click();
    await expect(editor.locator("h2 strong")).toHaveCount(0);
    await expect(editor.locator("p strong")).toHaveText("plain");
    await page.evaluate(() => window.floatingToolbarFixture.undo("A"));
    await expect(editor.locator("p strong")).toHaveCount(0);
    await page.evaluate(() => window.floatingToolbarFixture.redo("A"));
    await expect(editor.locator("p strong")).toHaveText("plain");
    await page.evaluate(() => window.floatingToolbarFixture.selectRange("A", 1, 6));
    await expect(bold).toBeDisabled();
    await page.evaluate(() => window.floatingToolbarFixture.destroy("A"));
  });

  if (kind !== "core") {
    test(`${kind} 先装配两个工具栏再通知实例就绪`, async ({ page }) => {
      await page.evaluate((kind) => window.floatingToolbarFixture.mount(kind, "A", "custom", "custom"), kind);
      await page.waitForFunction(() => window.floatingToolbarFixture.order("A").includes("ready"));
      expect(await page.evaluate(() => window.floatingToolbarFixture.order("A"))).toEqual([
        "main",
        "floating",
        "ready",
      ]);
      await page.evaluate(() => window.floatingToolbarFixture.destroy("A"));
    });
  }
}

test("主工具栏和浮动工具栏可分别配置，旧关闭行为保持不变", async ({ page }) => {
  await page.evaluate(() => {
    window.floatingToolbarFixture.mount("core", "A", "hidden", "custom");
    window.floatingToolbarFixture.mount("core", "B", "hidden", "default");
    window.floatingToolbarFixture.mount("core", "C", "hidden", "inherit");
    window.floatingToolbarFixture.mount("core", "D", "default", "hidden");
    window.floatingToolbarFixture.mount("core", "E", "custom", "custom");
  });
  const host = (id: string) => page.locator(`#floating-host-${id}`);
  await expect(host("A").getByRole("toolbar", { name: "文本格式" })).toHaveCount(0);
  await host("A").locator(".semlo-editor-prose").focus();
  await page.evaluate(() => window.floatingToolbarFixture.select("A"));
  await host("A").getByRole("button", { name: "自定义加粗 A" }).click();
  await expect(host("A").locator(".semlo-editor-prose strong")).toHaveText("hello world");
  await host("B").locator(".semlo-editor-prose").focus();
  await page.evaluate(() => window.floatingToolbarFixture.select("B"));
  const defaults = host("B").getByRole("toolbar", { name: "选中文字工具" });
  await expect(defaults.getByRole("button")).toHaveCount(1);
  await expect(defaults.getByRole("button", { name: "AI 写作", exact: true })).toBeDisabled();
  await expect(host("B").locator(".semlo-editor-prose")).toHaveText("hello world");
  expect(await page.evaluate(() => window.floatingToolbarFixture.selection("B"))).toEqual({ from: 1, to: 12 });
  await host("C").locator(".semlo-editor-prose").focus();
  await page.evaluate(() => window.floatingToolbarFixture.select("C"));
  await expect(host("C").locator(".semlo-editor-bubble")).toHaveCount(0);
  await host("D").locator(".semlo-editor-prose").focus();
  await page.evaluate(() => window.floatingToolbarFixture.select("D"));
  await expect(host("D").getByRole("toolbar", { name: "文本格式" })).toBeVisible();
  await expect(host("D").locator(".semlo-editor-bubble")).toHaveCount(0);
  await host("E").locator(".semlo-editor-prose").focus();
  await page.evaluate(() => window.floatingToolbarFixture.select("E"));
  await expect(host("E").getByRole("toolbar", { name: "文本格式" })).toHaveText("自定义主工具栏 E");
  await expect(host("E").getByRole("button", { name: "自定义加粗 E" })).toBeVisible();
  await host("E").getByRole("button", { name: "自定义斜体 E" }).click();
  await expect(host("E").locator(".semlo-editor-prose em")).toHaveText("hello world");
  await page.evaluate(() => {
    for (const id of ["A", "B", "C", "D", "E"]) window.floatingToolbarFixture.destroy(id);
  });
});

test("浮动菜单随选区变化显示，并在实例销毁和重挂载后隔离", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(() => {
    window.floatingToolbarFixture.mount("core", "A");
    window.floatingToolbarFixture.mount("core", "B");
  });
  const first = page.locator("#floating-host-A");
  const second = page.locator("#floating-host-B");
  await first.locator(".semlo-editor-prose").focus();
  await page.evaluate(() => window.floatingToolbarFixture.select("A"));
  await expect(first.getByRole("button", { name: "自定义加粗 A" })).toBeVisible();
  const before = await page.evaluate(() => window.floatingToolbarFixture.updateCount("B"));
  await page.evaluate(() => window.floatingToolbarFixture.collapse("A"));
  await expect(first.getByRole("toolbar", { name: "选中文字工具" })).toBeHidden();
  expect(await page.evaluate(() => window.floatingToolbarFixture.updateCount("B"))).toBe(before);
  await page.evaluate(() => {
    window.floatingToolbarFixture.destroy("A");
    window.floatingToolbarFixture.staleContext("A");
    window.floatingToolbarFixture.remount("B");
  });
  await second.locator(".semlo-editor-prose").focus();
  await page.evaluate(() => window.floatingToolbarFixture.select("B"));
  await second.getByRole("button", { name: "自定义斜体 B" }).click();
  await expect(second.locator(".semlo-editor-prose em")).toHaveText("hello world");
  expect(await page.evaluate(() => window.floatingToolbarFixture.cleanupCount("A"))).toBe(1);
  expect(await page.evaluate(() => window.floatingToolbarFixture.cleanupCount("B"))).toBe(0);
  await page.evaluate(() => window.floatingToolbarFixture.destroyUnderlying("B"));
  expect(await page.evaluate(() => window.floatingToolbarFixture.cleanupCount("B"))).toBe(1);
  await page.evaluate(() => window.floatingToolbarFixture.destroy("B"));
  expect(await page.evaluate(() => window.floatingToolbarFixture.cleanupCount("B"))).toBe(1);
  expect(errors).toEqual([]);
});

test("不传锚点时可使用浮动容器打开链接弹层", async ({ page }) => {
  await page.evaluate(() => window.floatingToolbarFixture.mount("core", "A", "hidden"));
  const editor = page.locator("#floating-host-A .semlo-editor-prose");
  await editor.focus();
  await page.evaluate(() => window.floatingToolbarFixture.select("A"));
  await expect(page.getByRole("button", { name: "自定义链接 A" })).toBeVisible();
  await page.evaluate(() => window.floatingToolbarFixture.openLink("A"));
  const link = page.getByRole("dialog", { name: "插入链接" });
  await expect(link.getByLabel("文本")).toHaveValue("hello world");
  await link.getByLabel("链接", { exact: true }).fill("https://example.com");
  await link.getByRole("button", { name: "确定" }).click();
  await expect(editor.locator("a")).toHaveAttribute("href", "https://example.com");
  await page.evaluate(() => window.floatingToolbarFixture.destroy("A"));
});

test("工厂失败、重入销毁及清理异常均释放两个工具栏", async ({ page }) => {
  const expectations = {
    throw: { message: "浮动工具栏装配失败", empty: true, destroyed: true, mainCleanups: 1, bubbleCleanups: 0 },
    destroy: {
      message: "自定义浮动工具栏装配期间编辑器已销毁或卸载",
      empty: true,
      destroyed: true,
      mainCleanups: 1,
      bubbleCleanups: 1,
    },
    unmount: {
      message: "自定义浮动工具栏装配期间编辑器已销毁或卸载",
      empty: true,
      destroyed: true,
      mainCleanups: 1,
      bubbleCleanups: 1,
    },
    invalid: {
      message: "自定义浮动工具栏必须返回清理函数或不返回值",
      empty: true,
      destroyed: true,
      mainCleanups: 1,
      bubbleCleanups: 0,
    },
    cleanup: { message: "浮动工具栏清理失败", empty: true, destroyed: true, mainCleanups: 1, bubbleCleanups: 1 },
  } as const;
  for (const mode of ["throw", "destroy", "unmount", "invalid", "cleanup"] as const)
    expect(await page.evaluate((mode) => window.floatingToolbarFixture.failure(mode), mode)).toEqual(
      expectations[mode],
    );
});

test("窄屏下可用键盘操作自定义浮动工具栏", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => window.floatingToolbarFixture.mount("core", "A", "hidden"));
  const editor = page.locator("#floating-host-A .semlo-editor-prose");
  await editor.focus();
  await page.evaluate(() => window.floatingToolbarFixture.select("A"));
  const bold = page.getByRole("button", { name: "自定义加粗 A" });
  await expect(bold).toBeVisible();
  await bold.focus();
  await page.keyboard.press("Enter");
  await expect(editor.locator("strong")).toHaveText("hello world");
  await page.evaluate(() => window.floatingToolbarFixture.destroy("A"));
});

test("触屏下可操作已选中文本的自定义浮动工具栏", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.floatingToolbarFixture));
    await page.evaluate(() => window.floatingToolbarFixture.mount("core", "A", "hidden"));
    const editor = page.locator("#floating-host-A .semlo-editor-prose");
    await editor.tap();
    await page.evaluate(() => window.floatingToolbarFixture.select("A"));
    await page.getByRole("button", { name: "自定义加粗 A" }).tap();
    await expect(editor.locator("strong")).toHaveText("hello world");
    await page.evaluate(() => window.floatingToolbarFixture.destroy("A"));
  } finally {
    await context.close();
  }
});
