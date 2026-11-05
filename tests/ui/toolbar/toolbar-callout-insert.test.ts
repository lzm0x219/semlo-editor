import { createRsbuild } from "@rsbuild/core";
import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    calloutFixture?: {
      run(insideDetails: boolean, middle: boolean): any;
      blocked(): { result: string; unchanged: boolean };
      mount(insideDetails: boolean, middle: boolean): void;
      mountPlain(): void;
      mountQuote(): void;
      readTone(): string | null;
      rememberTone(value: string): void;
      unavailableStorage(): string | null;
      blockStorage(): void;
      restoreStorage(): void;
      appendPlain(): void;
      snapshot(): any;
      undo(): boolean;
    };
  }
}

test("slash insertion splits callouts in their original container and undo restores them", async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/toolbar/toolbar-callout-insert-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
      output: { distPath: { root: "/tmp/semlo-editor-callout-insert-fixture-unused" } },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    expect(await page.evaluate(() => window.__semloRequireFixture("calloutFixture").readTone())).toBeNull();
    await page.evaluate(() => window.__semloRequireFixture("calloutFixture").rememberTone("purple"));
    await page.evaluate(() => window.__semloRequireFixture("calloutFixture").rememberTone("invalid"));
    expect(await page.evaluate(() => window.__semloRequireFixture("calloutFixture").readTone())).toBe("purple");
    expect(await page.evaluate(() => window.__semloRequireFixture("calloutFixture").unavailableStorage())).toBe("cyan");
    await page.reload();
    expect(await page.evaluate(() => window.__semloRequireFixture("calloutFixture").readTone())).toBe("purple");
    expect(await page.evaluate(() => window.__semloRequireFixture("calloutFixture").blocked())).toEqual({
      result: "blocked",
      unchanged: true,
    });
    for (const insideDetails of [false, true]) {
      for (const middle of [false, true]) {
        const result = await page.evaluate(
          ([details, split]) => window.__semloRequireFixture("calloutFixture").run(details, split),
          [insideDetails, middle],
        );
        expect(result.result).toBe("inserted");
        const cards = insideDetails ? result.after.content[0].content[1].content : result.after.content;
        expect(cards.map((node: any) => node.type)).toEqual(Array(middle ? 3 : 2).fill("callout"));
        expect(cards.map((node: any) => node.attrs.tone)).toEqual(
          middle ? ["purple", "gray", "purple"] : ["purple", "gray"],
        );
        expect(cards[0].content[0].content[0].text).toBe("前文");
        if (middle) expect(cards[2].content[0].content[0].text).toBe("后文");
        expect(result.selectionParent).toBe("paragraph");
        expect(result.focusInside).toBe("callout");
        expect(result.undone).toBe(true);
        expect(result.restored).toEqual(result.before);
      }
    }
    for (const insideDetails of [false, true]) {
      for (const middle of [false, true]) {
        await page.evaluate(
          ([details, split]) => window.__semloRequireFixture("calloutFixture").mount(details, split),
          [insideDetails, middle],
        );
        await page.locator("#callout-fixture aside[data-semlo-editor-callout] p").nth(1).click();
        await page.keyboard.type("/");
        await page.keyboard.insertText("高亮");
        const panel = page.getByRole("listbox", { name: "插入内容" });
        await expect(panel.locator('.semlo-editor-card-item[data-command="callout"]')).toBeVisible();
        const before = await page.evaluate(() => window.__semloRequireFixture("calloutFixture").snapshot());
        await panel.locator('.semlo-editor-card-item[data-command="callout"]').click();
        await expect(page.locator("#callout-fixture .semlo-editor-prose")).toBeFocused();
        const after = await page.evaluate(() => window.__semloRequireFixture("calloutFixture").snapshot());
        const cards = insideDetails ? after.content[0].content[1].content : after.content;
        expect(cards.map((node: any) => node.type)).toEqual(Array(middle ? 3 : 2).fill("callout"));
        expect(cards[0].content[0].content[0].text).toBe("前文");
        if (middle) expect(cards[2].content[0].content[0].text).toBe("后文");
        expect(await page.evaluate(() => window.__semloRequireFixture("calloutFixture").undo())).toBe(true);
        expect(await page.evaluate(() => window.__semloRequireFixture("calloutFixture").snapshot())).toEqual(before);
      }
    }
    await page.evaluate(() => window.__semloRequireFixture("calloutFixture").mountQuote());
    await page.locator("#callout-fixture aside[data-semlo-editor-callout] p").nth(1).click();
    await page.keyboard.type("/");
    await page.keyboard.insertText("高亮");
    const quoteBefore = await page.evaluate(() => window.__semloRequireFixture("calloutFixture").snapshot());
    await page
      .getByRole("listbox", { name: "插入内容" })
      .locator('.semlo-editor-card-item[data-command="callout"]')
      .click();
    const quote = await page.evaluate(() => window.__semloRequireFixture("calloutFixture").snapshot());
    expect(quote.content[0].type).toBe("blockquote");
    expect(quote.content[0].content.map((node: any) => node.type)).toEqual(["paragraph", "callout", "callout"]);
    expect(await page.evaluate(() => window.__semloRequireFixture("calloutFixture").undo())).toBe(true);
    expect(await page.evaluate(() => window.__semloRequireFixture("calloutFixture").snapshot())).toEqual(quoteBefore);
    await page.evaluate(() => window.__semloRequireFixture("calloutFixture").mountPlain());
    await page.locator("#callout-fixture .semlo-editor-prose p").click();
    await page.keyboard.type("/");
    await page.keyboard.insertText("高亮");
    await page
      .getByRole("listbox", { name: "插入内容" })
      .locator('.semlo-editor-card-item[data-command="callout"]')
      .click();
    const plain = await page.evaluate(() => window.__semloRequireFixture("calloutFixture").snapshot());
    expect(plain.content[0].type).toBe("callout");
    await page.locator("#callout-fixture aside[data-semlo-editor-callout] p").first().click();
    await page.getByRole("toolbar", { name: "高亮块配色" }).getByRole("button", { name: "浅绿" }).click();
    expect(await page.evaluate(() => window.__semloRequireFixture("calloutFixture").readTone())).toBe("green");
    expect(await page.evaluate(() => window.__semloRequireFixture("calloutFixture").undo())).toBe(true);
    expect(await page.evaluate(() => window.__semloRequireFixture("calloutFixture").readTone())).toBe("green");
    await page.evaluate(() => window.__semloRequireFixture("calloutFixture").appendPlain());
    await page.locator("#callout-fixture .semlo-editor-prose > p").last().click();
    await page.keyboard.type("/");
    await page.keyboard.insertText("高亮");
    await page
      .getByRole("listbox", { name: "插入内容" })
      .locator('.semlo-editor-card-item[data-command="callout"]')
      .click();
    expect(
      (await page.evaluate(() => window.__semloRequireFixture("calloutFixture").snapshot())).content.at(-1).attrs.tone,
    ).toBe("green");
    await page.evaluate(() => window.__semloRequireFixture("calloutFixture").mountPlain());
    await page.locator("#callout-fixture .semlo-editor-prose p").click();
    await page.keyboard.type("/");
    await page.keyboard.insertText("高亮");
    await page
      .getByRole("listbox", { name: "插入内容" })
      .locator('.semlo-editor-card-item[data-command="callout"]')
      .click();
    expect(
      (await page.evaluate(() => window.__semloRequireFixture("calloutFixture").snapshot())).content[0].attrs.tone,
    ).toBe("green");
    await page.evaluate(() => window.__semloRequireFixture("calloutFixture").mount(false, false));
    await page.locator("#callout-fixture aside[data-semlo-editor-callout] p").first().click();
    const sameColorBefore = await page.evaluate(() => window.__semloRequireFixture("calloutFixture").snapshot());
    await page.getByRole("toolbar", { name: "高亮块配色" }).getByRole("button", { name: "紫色" }).click();
    expect(await page.evaluate(() => window.__semloRequireFixture("calloutFixture").snapshot())).toEqual(
      sameColorBefore,
    );
    expect(await page.evaluate(() => window.__semloRequireFixture("calloutFixture").readTone())).toBe("purple");
    await page.reload();
    await page.evaluate(() => window.__semloRequireFixture("calloutFixture").mountPlain());
    await page.locator("#callout-fixture .semlo-editor-prose p").click();
    await page.keyboard.type("/");
    await page.keyboard.insertText("高亮");
    await page
      .getByRole("listbox", { name: "插入内容" })
      .locator('.semlo-editor-card-item[data-command="callout"]')
      .click();
    expect(
      (await page.evaluate(() => window.__semloRequireFixture("calloutFixture").snapshot())).content[0].attrs.tone,
    ).toBe("purple");
    await page.evaluate(() => window.__semloRequireFixture("calloutFixture").blockStorage());
    await page.locator("#callout-fixture aside[data-semlo-editor-callout] p").first().click();
    await page.getByRole("toolbar", { name: "高亮块配色" }).getByRole("button", { name: "浅青" }).click();
    expect(await page.evaluate(() => window.__semloRequireFixture("calloutFixture").readTone())).toBe("cyan");
    await page.evaluate(() => window.__semloRequireFixture("calloutFixture").mountPlain());
    await page.locator("#callout-fixture .semlo-editor-prose p").click();
    await page.keyboard.type("/");
    await page.keyboard.insertText("高亮");
    await page
      .getByRole("listbox", { name: "插入内容" })
      .locator('.semlo-editor-card-item[data-command="callout"]')
      .click();
    expect(
      (await page.evaluate(() => window.__semloRequireFixture("calloutFixture").snapshot())).content[0].attrs.tone,
    ).toBe("cyan");
    await page.evaluate(() => window.__semloRequireFixture("calloutFixture").restoreStorage());
  } finally {
    await server.close();
  }
});
