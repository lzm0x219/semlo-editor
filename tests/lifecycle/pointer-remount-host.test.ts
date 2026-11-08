import { expect, test } from "@rstest/playwright";

import { createFixtureRsbuild } from "../fixtures/browser/fixture-rsbuild";

test("pointer selection remains bound after a host mount listener throws and plugin reconfiguration", async ({
  page,
}) => {
  const rsbuild = await createFixtureRsbuild("./tests/fixtures/lifecycle/pointer-remount-host-fixture.ts", {
    publicDir: false,
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    const result = await page.evaluate(() => {
      const { controller, host, errors, getSynchronousDispatches, reconfigure } = (window as any).pointerProbe;
      const initial = { errors: [...errors], dispatches: getSynchronousDispatches() };
      const editor = controller.editor;
      editor.on("mount", () => {
        throw new Error("host mount failure");
      });
      editor.unmount();
      const targetMount = document.createElement("div");
      host.querySelector(".semlo-editor-content")!.append(targetMount);
      let failure = "";
      try {
        editor.mount(targetMount);
      } catch (error) {
        failure = (error as Error).message;
      }
      reconfigure();
      const view = editor.view;
      let pos = 0;
      editor.state.doc.descendants((node: any, position: number) => {
        if (node.type.name === "horizontalRule") pos = position;
      });
      editor.commands.setNodeSelection(pos);
      view.focus();
      const text = view.dom.querySelector("p").firstChild;
      view.dom.dispatchEvent(
        new PointerEvent("pointerdown", { pointerId: 7, button: 0, clientX: 1, clientY: 1, bubbles: true }),
      );
      reconfigure();
      document.getSelection()!.setBaseAndExtent(text, 0, text, 2);
      document.dispatchEvent(
        new PointerEvent("pointerup", { pointerId: 7, button: 0, clientX: 30, clientY: 1, bubbles: true }),
      );
      host.querySelector('button[aria-label="加粗"]').click();
      return { failure, html: controller.getSnapshot().html, initial };
    });
    expect(result.failure).toBe("host mount failure");
    expect(result.initial.dispatches).toBeGreaterThan(0);
    expect(result.initial.errors).toEqual([]);
    expect(result.html).toContain("<strong>目标</strong>文字");
  } finally {
    await server.close();
  }
});

test("real mouse selects and formats text after remount", async ({ page }) => {
  const rsbuild = await createFixtureRsbuild("./tests/fixtures/lifecycle/pointer-remount-host-fixture.ts", {
    publicDir: false,
  });
  const { port, server } = await rsbuild.startDevServer();
  try {
    await page.goto(`http://127.0.0.1:${port}`);
    const points = await page.evaluate(() => {
      const { controller, host } = (window as any).pointerProbe;
      controller.editor.unmount();
      const mount = document.createElement("div");
      host.querySelector(".semlo-editor-content").append(mount);
      controller.editor.mount(mount);
      const text = controller.editor.view.dom.querySelector("p").firstChild;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 2);
      const rect = range.getBoundingClientRect();
      return { x1: rect.left + 1, x2: rect.right - 1, y: (rect.top + rect.bottom) / 2 };
    });
    await page.mouse.move(points.x1, points.y);
    await page.mouse.down();
    await page.mouse.move(points.x2, points.y, { steps: 8 });
    await page.mouse.up();
    expect(await page.evaluate(() => document.getSelection()!.toString())).toBe("目标");
    await page.getByRole("toolbar", { name: "文本格式" }).getByRole("button", { name: "加粗" }).click();
    expect(await page.evaluate(() => (window as any).pointerProbe.controller.getSnapshot().html)).toContain(
      "<strong>目标</strong>文字",
    );
  } finally {
    await server.close();
  }
});
