import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { startFixtureServer } from "../fixtures/browser/fixture-rsbuild";
import type { BoundaryFramework } from "../fixtures/contracts/adapter-boundary-fixture";

let origin: string;
let closeServer: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop: closeServer } = await startFixtureServer("./tests/fixtures/contracts/adapter-boundary-fixture.ts", {
    framework: true,
  }));
});
afterAll(async () => closeServer?.());

for (const framework of ["react", "vue", "solid"] as const satisfies readonly BoundaryFramework[]) {
  test(`${framework} 动态监听、受控回写和宿主节点保护`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.mountBoundaryFixture === "function");
    await page.evaluate((name) => window.mountBoundaryFixture!(name), framework);
    const first = page.locator("#editor-a");
    const second = page.locator("#editor-b");
    await expect(first.locator(".semlo-editor-prose")).toHaveCount(1);
    await expect(second.locator(".semlo-editor-prose")).toHaveCount(1);
    await first.dispatchEvent("click");

    await page.evaluate(() => window.boundaryFixture!.controllers[0].editor.commands.insertContent("一"));
    expect(await page.evaluate(() => window.boundaryFixture!.snapshots)).toEqual([0, 0]);
    await page.evaluate(async () => {
      window.boundaryFixture!.listen(true);
      await window.boundaryFixture!.settle();
    });
    await page.evaluate(() => window.boundaryFixture!.controllers[0].editor.commands.insertContent("二"));
    await page.evaluate(() => window.boundaryFixture!.settle());
    expect(await page.evaluate(() => window.boundaryFixture!.snapshots)).toEqual([1, 0]);
    expect(await page.evaluate(() => window.boundaryFixture!.changes)).toEqual(["一二"]);
    await page.evaluate(async () => {
      window.boundaryFixture!.listen(false);
      await window.boundaryFixture!.settle();
    });
    await page.evaluate(() => window.boundaryFixture!.controllers[0].editor.commands.insertContent("三"));
    expect(await page.evaluate(() => window.boundaryFixture!.snapshots)).toEqual([1, 0]);
    expect(await page.evaluate(() => window.boundaryFixture!.changes)).toEqual(["一二"]);

    await page.evaluate(async () => {
      window.boundaryFixture!.content("<p>宿主回写</p>");
      await window.boundaryFixture!.settle();
      window.boundaryFixture!.unsafe();
      await window.boundaryFixture!.settle();
    });
    // HTML 回写会序列化当前内容以判断是否为自身输出。
    expect(await page.evaluate(() => window.boundaryFixture!.snapshots)).toEqual([2, 0]);
    await expect(first).toHaveAttribute("title", "更新后");
    await expect(first.locator(".semlo-editor-prose")).toHaveText("宿主回写");
    await expect(first).not.toContainText("覆盖内容");
    await expect(first).not.toContainText("覆盖子节点");
    await expect(first).not.toContainText("覆盖文本");
    await expect(first).not.toContainText("强制覆盖");
    await expect(first).not.toContainText("强制文本");
    await first.dispatchEvent("click");
    expect(await page.evaluate(() => window.boundaryFixture!.clicks)).toEqual(["初始", "更新后"]);
    await expect(second.locator(".semlo-editor-prose")).toHaveCount(1);
    await page.evaluate(() => window.boundaryFixture!.controllers[1].editor.commands.insertContent("独立实例"));
    await expect(second.locator(".semlo-editor-prose")).toHaveText("独立实例");
    expect(await page.evaluate(() => window.boundaryFixture!.snapshots)).toEqual([2, 0]);
    expect(await page.evaluate(() => window.boundaryFixture!.changes)).toEqual(["一二"]);

    expect(
      await page.evaluate(() => {
        const { controllers } = window.boundaryFixture!;
        window.boundaryFixture!.destroy();
        return controllers.map((controller) => controller.editor.isDestroyed);
      }),
    ).toEqual([true, true]);
    await expect(first).toHaveCount(0);
    await page.evaluate((name) => window.mountBoundaryFixture!(name), framework);
    await expect(page.locator("#editor-a .semlo-editor-prose")).toHaveCount(1);
    expect(
      await page.evaluate(() => window.boundaryFixture!.controllers.map((value) => value.editor.isDestroyed)),
    ).toEqual([false, false]);
    await page.evaluate(() => window.boundaryFixture!.destroy());
    expect(errors).toEqual([]);
  });
}

test("React 只向已提交的回调发送编辑事件", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountConcurrentFixture === "function");
  await page.evaluate(() => window.mountConcurrentFixture!());
  await page.evaluate(() => window.concurrentFixture!.suspend());
  await page.waitForFunction(() => window.concurrentFixture!.attempts.includes(1));
  await page.evaluate(() => window.concurrentFixture!.controller.editor.commands.insertContent("一"));
  expect(await page.evaluate(() => window.concurrentFixture!.callbacks)).toEqual([0]);
  await page.evaluate(() =>
    window.concurrentFixture!.controller.setContent({ type: "doc", content: [{ type: "未知" }] }),
  );
  expect(await page.evaluate(() => window.concurrentFixture!.errors)).toEqual([0]);
  await page.evaluate(() => window.concurrentFixture!.release());
  await expect
    .poll(async () => {
      await page.evaluate(() => window.concurrentFixture!.controller.editor.commands.insertContent("二"));
      return page.evaluate(() => window.concurrentFixture!.callbacks.at(-1));
    })
    .toBe(1);
  expect(await page.evaluate(() => window.concurrentFixture!.controller.editor.isDestroyed)).toBe(false);
  await page.evaluate(() => window.concurrentFixture!.destroy());
});

test("React 的 onReady 抛错后销毁已创建的实例", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountFailingReadyFixture === "function");
  const result = await page.evaluate(async () => {
    const { controller, errors } = await window.mountFailingReadyFixture!();
    return { destroyed: controller.editor.isDestroyed, errors };
  });
  expect(result).toEqual({ destroyed: true, errors: ["ready 故障"] });
});
