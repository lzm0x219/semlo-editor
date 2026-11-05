import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../packages/core/src/types";
import type { SemloEditorProps } from "../../packages/solid/src/index";
import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    mountSolidAttributesEditor?(): Promise<void>;
    solidAttributesEditor?: {
      controller: EditorController;
      clicks: string[];
      hostRef: HTMLDivElement | undefined;
      update(): void;
      destroy(): void;
    };
    mountVueMutableContentEditor?(): Promise<void>;
    vueMutableContentEditor?: {
      controller: EditorController;
      changes: string[];
      updateNested(): void;
      replaceEquivalent(): void;
      settle(): Promise<void>;
      destroy(): void;
    };
  }
}

test("Solid adapter forwards reactive DOM attributes, events and the host ref", async ({ page }) => {
  const initial: Pick<SemloEditorProps, "id" | "title" | "aria-label" | "data-test-state"> = {
    id: "solid-editor-initial",
    title: "初始标题",
    "aria-label": "初始编辑器",
    "data-test-state": "initial",
  };
  await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
  await page.evaluate(() => window.__semloRequireFixture("mountSolidAttributesEditor").bind(window)());
  const host = page.locator("#solid-attributes-fixture > div");
  await expect(host).toHaveAttribute("id", initial.id!);
  await expect(host).toHaveClass("initial-class");
  await expect(host).toHaveAttribute("title", initial.title!);
  await expect(host).toHaveAttribute("aria-label", initial["aria-label"]!);
  await expect(host).toHaveAttribute("data-test-state", String(initial["data-test-state"]));
  expect(
    await host.evaluate((element) => element === window.__semloRequireFixture("solidAttributesEditor").hostRef),
  ).toBe(true);
  await host.click({ position: { x: 2, y: 2 } });
  expect(await page.evaluate(() => window.__semloRequireFixture("solidAttributesEditor").clicks)).toEqual(["initial"]);

  await page.evaluate(() => window.__semloRequireFixture("solidAttributesEditor").update());
  await expect(host).toHaveAttribute("id", "solid-editor-updated");
  await expect(host).toHaveClass("updated-class");
  await expect(host).toHaveAttribute("title", "更新标题");
  await expect(host).toHaveAttribute("aria-label", "更新编辑器");
  await expect(host).toHaveAttribute("data-test-state", "updated");
  expect(
    await host.evaluate((element) => element === window.__semloRequireFixture("solidAttributesEditor").hostRef),
  ).toBe(true);
  await host.click({ position: { x: 2, y: 2 } });
  expect(await page.evaluate(() => window.__semloRequireFixture("solidAttributesEditor").clicks)).toEqual([
    "initial",
    "updated",
  ]);

  await page.evaluate(() => window.__semloRequireFixture("solidAttributesEditor").destroy());
  await expect(host).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("solidAttributesEditor").controller.editor.isDestroyed),
  ).toBe(true);
});

test("Vue adapter observes nested reactive content without echoing equivalent updates", async ({ page }) => {
  await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
  await page.evaluate(() => window.__semloRequireFixture("mountVueMutableContentEditor").bind(window)());
  const prose = page.locator("#vue-mutable-content-fixture .semlo-editor-prose");
  await expect(prose).toHaveText("初始");
  await page.evaluate(async () => {
    window.__semloRequireFixture("vueMutableContentEditor").updateNested();
    await window.__semloRequireFixture("vueMutableContentEditor").settle();
  });
  await expect(prose).toHaveText("外部更改");
  expect(await page.evaluate(() => window.__semloRequireFixture("vueMutableContentEditor").changes)).toEqual([]);

  await prose.click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await expect(prose).toHaveText("外部更改!");
  await page.evaluate(() => window.__semloRequireFixture("vueMutableContentEditor").settle());
  expect(await page.evaluate(() => window.__semloRequireFixture("vueMutableContentEditor").changes)).toEqual([
    "外部更改!",
  ]);
  const selection = await page.evaluate(() =>
    window.__semloRequireFixture("vueMutableContentEditor").controller.editor.state.selection.toJSON(),
  );
  await page.evaluate(async () => {
    window.__semloRequireFixture("vueMutableContentEditor").replaceEquivalent();
    await window.__semloRequireFixture("vueMutableContentEditor").settle();
  });
  expect(
    await page.evaluate(() =>
      window.__semloRequireFixture("vueMutableContentEditor").controller.editor.state.selection.toJSON(),
    ),
  ).toEqual(selection);
  expect(await page.evaluate(() => window.__semloRequireFixture("vueMutableContentEditor").changes)).toEqual([
    "外部更改!",
  ]);

  await page.evaluate(() => window.__semloRequireFixture("vueMutableContentEditor").destroy());
  await expect(prose).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("vueMutableContentEditor").controller.editor.isDestroyed),
  ).toBe(true);
});
