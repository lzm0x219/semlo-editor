import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(({ page }) => installFixtureGuards(page));

for (const mode of [
  "direct",
  "controller",
  "during",
  "during-direct",
  "during-readonly",
  "rejected",
  "readonly",
  "replace",
] as const) {
  test(`resize listeners are cleaned up when the start is ${mode}`, async ({ page }) => {
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
        import { createEditor } from '/dist/index.js'
        const host = document.createElement('div')
        host.id = 'table-navigation-test'
        host.style.width = '520px'
        document.body.prepend(host)
        window.tableNavigationEditor = createEditor({ element: host, outline: false, content: '<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table>' })
      `,
    });
    await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
    const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
    const prose = page.locator("#table-navigation-test .semlo-editor-prose");
    const box = await prose.getByRole("cell", { name: "A", exact: true }).boundingBox();
    if (!box) throw new Error("Missing cell");
    await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2);
    await expect(prose.locator(".column-resize-handle").first()).toBeVisible();
    await page.evaluate((mode) => {
      const controller = window.__semloRequireFixture("tableNavigationEditor");
      const editor = controller.editor;
      const plugin = editor.state.plugins.find((p) =>
        (p as unknown as { key: string }).key.includes("tableColumnResizing"),
      );
      if (!plugin) throw new Error("Missing column resize plugin");
      if (mode === "rejected") {
        const Plugin = editor.state.plugins[0].constructor as typeof import("@tiptap/pm/state").Plugin;
        editor.registerPlugin(new Plugin({ filterTransaction: (tr) => !tr.getMeta(plugin)?.setDragging }));
      }
      const tracked = new Map<EventListenerOrEventListenerObject, string>();
      const add = window.addEventListener,
        remove = window.removeEventListener;
      window.addEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) {
        if ((type === "mousemove" || type === "mouseup") && listener) tracked.set(listener, type);
        return add.call(window, type, listener, options);
      } as typeof window.addEventListener;
      window.removeEventListener = function (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions,
      ) {
        if (listener) tracked.delete(listener);
        return remove.call(window, type, listener, options);
      } as typeof window.removeEventListener;
      (window as unknown as { resizeListenerCount: () => number }).resizeListenerCount = () => tracked.size;
      editor.on("transaction", ({ transaction }) => {
        if (!transaction.getMeta(plugin)?.setDragging) return;
        if (mode === "direct") editor.destroy();
        if (mode === "controller") controller.destroy();
        if (mode === "readonly") controller.setEditable(false);
        if (mode === "replace") controller.setContent("<p>替换</p>");
      });
    }, mode);
    await page.mouse.down();
    if (mode === "during" || mode === "during-direct" || mode === "during-readonly") {
      await page.mouse.move(box.x + box.width + 25, box.y + box.height / 2, { steps: 4 });
      expect(
        await page.evaluate(() => (window as unknown as { resizeListenerCount: () => number }).resizeListenerCount()),
      ).toBe(2);
      await page.evaluate((mode) => {
        const controller = window.__semloRequireFixture("tableNavigationEditor");
        if (mode === "during-direct") controller.editor.destroy();
        else if (mode === "during-readonly") controller.setEditable(false);
        else controller.destroy();
      }, mode);
    }
    if (mode === "direct" || mode === "controller" || mode === "during" || mode === "during-direct")
      expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.isDestroyed)).toBe(
        true,
      );
    if (mode === "readonly" || mode === "during-readonly")
      expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.isEditable)).toBe(
        false,
      );
    if (mode === "rejected" || mode === "readonly" || mode === "during-readonly")
      expect(
        await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json),
      ).toEqual(before);
    if (mode === "replace") await expect(prose).toHaveText("替换");
    expect(
      await page.evaluate(() => (window as unknown as { resizeListenerCount: () => number }).resizeListenerCount()),
    ).toBe(0);
    await page.mouse.up();
  });
}

for (const mode of ["direct", "controller"] as const) {
  test(`row selection can synchronously destroy via ${mode}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
    window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table>' })
  `,
    });
    await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
    await page.locator("#table-navigation-test td").first().hover();
    const handle = page.getByRole("button", { name: "选择第 1 行" });
    await expect(handle).toBeVisible();
    const box = await handle.boundingBox();
    if (!box) throw new Error("Missing row handle");
    await page.evaluate((mode) => {
      const controller = window.__semloRequireFixture("tableNavigationEditor");
      const editor = controller.editor;
      editor.on("transaction", ({ transaction }) => {
        if (transaction.selection.toJSON().type !== "cell") return;
        if (mode === "direct") editor.destroy();
        else controller.destroy();
      });
    }, mode);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.isDestroyed)).toBe(
      true,
    );
    await page.mouse.up();
    expect(errors).toEqual([]);
  });
}

test("a throwing resize-start transaction leaves the next drag usable", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'table-navigation-test'; host.style.width = '520px'; document.body.prepend(host)
    window.tableNavigationEditor = createEditor({ element: host, outline: false, content: '<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table>' })
  `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const prose = page.locator("#table-navigation-test .semlo-editor-prose");
  const box = await prose.getByRole("cell", { name: "A", exact: true }).boundingBox();
  if (!box) throw new Error("Missing cell");
  const x = box.x + box.width - 1,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await expect(prose.locator(".column-resize-handle").first()).toBeVisible();
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("tableNavigationEditor").editor;
    const plugin = editor.state.plugins.find((p) =>
      (p as unknown as { key: string }).key.includes("tableColumnResizing"),
    )!;
    const Plugin = editor.state.plugins[0].constructor as typeof import("@tiptap/pm/state").Plugin;
    let reject = true;
    editor.registerPlugin(
      new Plugin({
        filterTransaction: (tr) => {
          if (reject && tr.getMeta(plugin)?.setDragging) {
            reject = false;
            throw new Error("planned resize rejection");
          }
          return true;
        },
      }),
    );
    const tracked = new Set<EventListenerOrEventListenerObject>();
    const add = window.addEventListener,
      remove = window.removeEventListener;
    window.addEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === "mousemove" || type === "mouseup") tracked.add(listener);
      return add.call(window, type, listener, options);
    } as typeof window.addEventListener;
    window.removeEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) {
      tracked.delete(listener);
      return remove.call(window, type, listener, options);
    } as typeof window.removeEventListener;
    (window as unknown as { resizeListenerCount: () => number }).resizeListenerCount = () => tracked.size;
  });
  await page.mouse.down();
  await page.mouse.up();
  expect(errors).toContain("planned resize rejection");
  expect(
    await page.evaluate(() => (window as unknown as { resizeListenerCount: () => number }).resizeListenerCount()),
  ).toBe(0);
  await page.mouse.move(x, y);
  await expect(prose.locator(".column-resize-handle").first()).toBeVisible();
  await page.mouse.down();
  expect(
    await page.evaluate(() => (window as unknown as { resizeListenerCount: () => number }).resizeListenerCount()),
  ).toBe(2);
  await page.mouse.up();
  expect(
    await page.evaluate(() => (window as unknown as { resizeListenerCount: () => number }).resizeListenerCount()),
  ).toBe(0);
});

for (const axis of ["行", "列"] as const) {
  for (const mode of [
    "replace",
    "focus",
    "selection",
    "readonly",
    "focus-selection",
    "focus-readonly",
    "focus-direct",
    "focus-controller",
  ] as const) {
    test(`${axis} selection tolerates synchronous ${mode} reentry`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(process.env.SEMLO_TEST_ORIGIN!);
      await page.addScriptTag({
        type: "module",
        content: `
        import { createEditor } from '/dist/index.js'
        const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
        window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table><p>后文</p>' })
      `,
      });
      await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
      await page.locator("#table-navigation-test td").first().hover();
      const handle = page.getByRole("button", { name: `选择第 1 ${axis}` });
      await expect(handle).toBeVisible();
      const box = await handle.boundingBox();
      if (!box) throw new Error("Missing selection handle");
      await page.evaluate((mode) => {
        const controller = window.__semloRequireFixture("tableNavigationEditor");
        let done = false;
        const reenter = () => {
          if (done) return;
          done = true;
          (window as unknown as { reentryTriggered: boolean }).reentryTriggered = true;
          if (mode === "replace" || mode === "focus") controller.setContent("<p>替换</p>");
          if (mode === "selection" || mode === "focus-selection")
            controller.editor.commands.setTextSelection(controller.editor.state.doc.content.size - 1);
          if (mode === "readonly" || mode === "focus-readonly") controller.setEditable(false);
          if (mode === "focus-direct") controller.editor.destroy();
          if (mode === "focus-controller") controller.destroy();
        };
        if (
          mode === "focus" ||
          mode === "focus-selection" ||
          mode === "focus-readonly" ||
          mode === "focus-direct" ||
          mode === "focus-controller"
        )
          controller.editor.view.dom.addEventListener("focus", reenter, { once: true });
        else
          controller.editor.on("transaction", ({ transaction }) => {
            if (transaction.selection.toJSON().type === "cell") reenter();
          });
      }, mode);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.up();
      expect(await page.evaluate(() => (window as unknown as { reentryTriggered?: boolean }).reentryTriggered)).toBe(
        true,
      );
      if (mode === "replace" || mode === "focus")
        await expect(page.locator("#table-navigation-test .semlo-editor-prose")).toHaveText("替换");
      if (mode === "selection" || mode === "focus-selection")
        expect(
          await page.evaluate(
            () => window.__semloRequireFixture("tableNavigationEditor").editor.state.selection.$from.parent.textContent,
          ),
        ).toBe("后文");
      if (mode === "readonly" || mode === "focus-readonly")
        expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.isEditable)).toBe(
          false,
        );
      if (mode === "focus-direct" || mode === "focus-controller")
        expect(
          await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.isDestroyed),
        ).toBe(true);
      expect(errors).toEqual([]);
    });
  }
}

test("code navigation discards its selection marker after synchronous document replacement", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
    window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td><pre><code>alpha</code></pre></td></tr></tbody></table>' })
  `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("tableNavigationEditor");
    const editor = controller.editor;
    const paragraph = document.querySelector("#table-navigation-test td p")!;
    editor.view.focus();
    editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
    let done = false;
    editor.on("transaction", ({ transaction }) => {
      if (done || transaction.selection.$from.parent.type.name !== "codeBlock") return;
      done = true;
      controller.setContent("<table><tbody><tr><td>A</td><td><pre><code>omega</code></pre></td></tr></tbody></table>");
      let position = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "codeBlock") position = pos;
      });
      editor.commands.setTextSelection({ from: position + 1, to: position + 6 });
    });
  });
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("omega");
  await page.keyboard.press("Shift+Tab");
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("tableNavigationEditor").editor.state.selection.$from.parent.type.name,
    ),
  ).toBe("codeBlock");
  await expect(page.locator("#table-navigation-test pre code")).toHaveText("omega");
});

for (const mode of ["selection", "readonly", "direct", "controller"] as const) {
  test(`code navigation stops safely when ${mode} occurs in the selection transaction`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td><pre><code>alpha</code></pre></td></tr></tbody></table>' })
    `,
    });
    await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
    await page.evaluate((mode) => {
      const controller = window.__semloRequireFixture("tableNavigationEditor");
      const editor = controller.editor;
      const paragraph = document.querySelector("#table-navigation-test td p")!;
      editor.view.focus();
      editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
      let done = false;
      editor.on("transaction", ({ transaction }) => {
        if (done || transaction.selection.$from.parent.type.name !== "codeBlock") return;
        done = true;
        if (mode === "selection") editor.commands.setTextSelection(transaction.selection.from);
        if (mode === "readonly") controller.setEditable(false);
        if (mode === "direct") editor.destroy();
        if (mode === "controller") controller.destroy();
      });
    }, mode);
    await page.keyboard.press("Tab");
    if (mode === "direct" || mode === "controller") {
      expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.isDestroyed)).toBe(
        true,
      );
    } else {
      if (mode === "readonly")
        await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").setEditable(true));
      await page.keyboard.press("Shift+Tab");
      expect(
        await page.evaluate(
          () => window.__semloRequireFixture("tableNavigationEditor").editor.state.selection.$from.parent.type.name,
        ),
      ).toBe("codeBlock");
    }
    expect(errors).toEqual([]);
  });
}

for (const framework of ["react", "vue", "solid"] as const) {
  for (const mode of ["start", "active"] as const) {
    test(`${framework} unmount during ${mode} resize leaves no window listeners`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
      await page.evaluate((name) => window.__semloRequireFixture("mountDynamicEditor").bind(window)(name), framework);
      await page.evaluate(() =>
        window
          .__semloRequireFixture("dynamicEditor")
          .controller.setContent("<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>"),
      );
      const host = page.locator("#dynamic-editor");
      const box = await host.getByRole("cell", { name: "A", exact: true }).boundingBox();
      if (!box) throw new Error("Missing table cell");
      await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2);
      await expect(host.locator(".column-resize-handle").first()).toBeVisible();
      await page.evaluate((mode) => {
        const fixture = window.__semloRequireFixture("dynamicEditor");
        const editor = fixture.controller.editor;
        const plugin = editor.state.plugins.find((p) =>
          (p as unknown as { key: string }).key.includes("tableColumnResizing"),
        );
        if (!plugin) throw new Error("Missing column resize plugin");
        const tracked = new Set<EventListenerOrEventListenerObject>();
        const add = window.addEventListener,
          remove = window.removeEventListener;
        window.addEventListener = function (
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | AddEventListenerOptions,
        ) {
          if (type === "mousemove" || type === "mouseup") tracked.add(listener);
          return add.call(window, type, listener, options);
        } as typeof window.addEventListener;
        window.removeEventListener = function (
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | EventListenerOptions,
        ) {
          tracked.delete(listener);
          return remove.call(window, type, listener, options);
        } as typeof window.removeEventListener;
        (window as unknown as { resizeListenerCount: () => number }).resizeListenerCount = () => tracked.size;
        editor.on("transaction", ({ transaction }) => {
          if (mode === "start" && transaction.getMeta(plugin)?.setDragging) fixture.destroy();
        });
      }, mode);
      await page.mouse.down();
      if (mode === "active") {
        await page.mouse.move(box.x + box.width + 25, box.y + box.height / 2, { steps: 4 });
        expect(
          await page.evaluate(() => (window as unknown as { resizeListenerCount: () => number }).resizeListenerCount()),
        ).toBe(2);
        await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").destroy());
      }
      await expect(host).toHaveCount(0);
      expect(
        await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").controller.editor.isDestroyed),
      ).toBe(true);
      expect(
        await page.evaluate(() => (window as unknown as { resizeListenerCount: () => number }).resizeListenerCount()),
      ).toBe(0);
      await page.mouse.up();
      expect(errors).toEqual([]);
    });
  }
}

for (const framework of ["react", "vue", "solid"] as const) {
  test(`${framework} unmount during row selection leaves no page errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
    await page.evaluate((name) => window.__semloRequireFixture("mountDynamicEditor").bind(window)(name), framework);
    await page.evaluate(() =>
      window
        .__semloRequireFixture("dynamicEditor")
        .controller.setContent(
          "<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table>",
        ),
    );
    const host = page.locator("#dynamic-editor");
    await host.getByRole("cell", { name: "A", exact: true }).hover();
    const handle = page.getByRole("button", { name: "选择第 1 行" });
    await expect(handle).toBeVisible();
    const box = await handle.boundingBox();
    if (!box) throw new Error("Missing row handle");
    await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("dynamicEditor");
      fixture.controller.editor.on("transaction", ({ transaction }) => {
        if (transaction.selection.toJSON().type === "cell") fixture.destroy();
      });
    });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(host).toHaveCount(0);
    expect(await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").controller.editor.isDestroyed)).toBe(
      true,
    );
    await page.mouse.up();
    expect(errors).toEqual([]);
  });
}

for (const axis of ["行", "列"] as const) {
  test(`host document replacement during ${axis} drag is preserved`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A1</td><td>A2</td><td>A3</td></tr><tr><td>B1</td><td>B2</td><td>B3</td></tr><tr><td>C1</td><td>C2</td><td>C3</td></tr></tbody></table>' })
    `,
    });
    await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
    await page.locator("#table-navigation-test td").first().hover();
    const from = page.getByRole("button", { name: `选择第 2 ${axis}` });
    const to = page.getByRole("button", { name: `选择第 3 ${axis}` });
    await expect(from).toBeVisible();
    await expect(to).toBeVisible();
    const source = await from.boundingBox(),
      target = await to.boundingBox();
    if (!source || !target) throw new Error("Missing selection handles");
    await page.evaluate(() => {
      const controller = window.__semloRequireFixture("tableNavigationEditor");
      let done = false;
      controller.editor.on("transaction", ({ transaction }) => {
        if (done || !transaction.docChanged) return;
        done = true;
        controller.setContent("<p>宿主新文档</p>");
      });
    });
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      axis === "行" ? target.x + target.width / 2 : target.x + target.width - 2,
      axis === "行" ? target.y + target.height - 2 : target.y + target.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();
    await expect(page.locator("#table-navigation-test .semlo-editor-prose")).toHaveText("宿主新文档");
    expect(errors).toEqual([]);
  });
}

test("toolbar survives host destruction during history boundary", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
    window.tableNavigationEditor = createEditor({ element: host, outline: false, content: '<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>' })
  `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  await page.locator("#table-navigation-test td").first().click();
  const toolbar = page.getByRole("toolbar", { name: "表格工具栏" });
  await expect(toolbar).toBeVisible();
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("tableNavigationEditor");
    let changed = false;
    controller.editor.on("transaction", ({ transaction }) => {
      if (changed) controller.destroy();
      else if (transaction.docChanged) changed = true;
    });
  });
  await toolbar.getByRole("button", { name: "隐藏边框" }).click();
  expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").editor.isDestroyed)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});

for (const cleanupThrows of [false, true]) {
  test(`table toolbar rolls back failed setup (cleanup throws: ${cleanupThrows})`, async ({ page }) => {
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
        import { createEditor } from '/dist/index.js'
        const setupError = new Error('toolbar observer failure')
        const cleanupError = new Error('toolbar listener cleanup failure')
        const OriginalObserver = window.ResizeObserver
        let cleanupThrown = false
        const tracked = []
        const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document)
        document.addEventListener = function(type, callback, options) {
          if (['outside', 'keydown', 'schedulePosition'].includes(callback.name)) tracked.push({type, callback, removed: false})
          return add(type, callback, options)
        }
        document.removeEventListener = function(type, callback, options) {
          tracked.filter(item => item.type === type && item.callback === callback).forEach(item => item.removed = true)
          const result = remove(type, callback, options)
          if (${cleanupThrows} && !cleanupThrown && type === 'pointerdown' && callback.name === 'outside' && new Error().stack?.includes('runCleanupSteps') && new Error().stack?.includes('mountTableToolbar')) { cleanupThrown = true; throw cleanupError }
          return result
        }
        window.ResizeObserver = class extends OriginalObserver {
          observe(target, options) {
            if ((target.matches('table') || target.querySelector('table')) && new Error().stack?.includes('mountTableToolbar')) throw setupError
            return super.observe(target, options)
          }
        }
        const existingToolbars = new Set(document.querySelectorAll('.semlo-editor-table-toolbar'))
        const host = document.createElement('div'); document.body.append(host)
        let caught
        try { createEditor({element: host, content: '<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>'}) } catch (error) { caught = error }
        window.tableToolbarSetupProbe = {
          original: caught === setupError,
          aggregate: caught instanceof AggregateError,
          cause: caught instanceof AggregateError && caught.cause === setupError && caught.errors[0] === setupError,
          cleanup: caught instanceof AggregateError && caught.errors[1] === cleanupError,
          active: tracked.filter(item => !item.removed).length,
          shell: host.children.length,
          toolbars: [...document.querySelectorAll('.semlo-editor-table-toolbar')].filter(toolbar => !existingToolbars.has(toolbar)).length,
          baselineIntact: [...existingToolbars].every(toolbar => toolbar.isConnected),
        }
      `,
    });
    await page.waitForFunction(() =>
      Boolean((window as unknown as { tableToolbarSetupProbe?: unknown }).tableToolbarSetupProbe),
    );
    const result = await page.evaluate(
      () => (window as unknown as { tableToolbarSetupProbe: unknown }).tableToolbarSetupProbe,
    );
    expect(result).toEqual({
      original: !cleanupThrows,
      aggregate: cleanupThrows,
      cause: cleanupThrows,
      cleanup: cleanupThrows,
      active: 0,
      shell: 0,
      toolbars: 0,
      baselineIntact: true,
    });
  });
}

for (const mode of ["destroy", "unmount", "throws"] as const) {
  test(`table toolbar cleans up when host ${mode}`, async ({ page }) => {
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
        import { createEditor } from '/dist/index.js'
        const tracked = []
        const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document)
        document.addEventListener = function(type, callback, options) {
          if (new Error().stack?.includes('mountTableToolbar')) tracked.push({type, callback, removed: false})
          return add(type, callback, options)
        }
        document.removeEventListener = function(type, callback, options) {
          tracked.filter(item => item.type === type && item.callback === callback).forEach(item => item.removed = true)
          return remove(type, callback, options)
        }
        const existingToolbars = new Set(document.querySelectorAll('.semlo-editor-table-toolbar'))
        const host = document.createElement('div'); document.body.append(host)
        const failure = new Error('host destroy failure')
        const controller = createEditor({element: host, content: '<table><tbody><tr><td>A</td></tr></tbody></table>'})
        if ('${mode}' === 'throws') controller.editor.on('destroy', () => { throw failure })
        const before = tracked.filter(item => !item.removed).length
        let caught
        try {
          if ('${mode}' === 'unmount') controller.editor.unmount()
          controller.destroy(); controller.destroy()
        } catch (error) { caught = error }
        window.tableToolbarDestroyProbe = {
          before, active: tracked.filter(item => !item.removed).length,
          toolbars: [...document.querySelectorAll('.semlo-editor-table-toolbar')].filter(toolbar => !existingToolbars.has(toolbar)).length,
          baselineIntact: [...existingToolbars].every(toolbar => toolbar.isConnected),
          shell: host.children.length, original: caught === failure,
        }
      `,
    });
    await page.waitForFunction(() =>
      Boolean((window as unknown as { tableToolbarDestroyProbe?: unknown }).tableToolbarDestroyProbe),
    );
    const result = await page.evaluate(
      () =>
        (
          window as unknown as {
            tableToolbarDestroyProbe: {
              before: number;
              active: number;
              toolbars: number;
              shell: number;
              original: boolean;
            };
          }
        ).tableToolbarDestroyProbe,
    );
    expect(result.before).toBeGreaterThan(0);
    expect(result).toEqual({
      before: result.before,
      active: 0,
      toolbars: 0,
      baselineIntact: true,
      shell: 0,
      original: mode === "throws",
    });
  });
}

for (const scenario of ["host", "partial", "partialcleanup", "hostcleanup"] as const) {
  test(`table registry cleans up a failed constructor: ${scenario}`, async ({ page }) => {
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
        import { createEditor } from '/dist/index.js'
        const seedHost = document.createElement('div'); document.body.append(seedHost)
        const seed = createEditor({element: seedHost, outline: false, toolbar: false})
        const Extension = seed.editor.extensionManager.extensions.find(extension => extension.type === 'extension').constructor
        const Plugin = seed.editor.state.plugins[0].constructor
        seed.destroy()
        const baseline = new Set(document.querySelectorAll('.semlo-editor-table-edges'))
        const hostError = new Error('host constructor failure'), setupError = new Error('listener install failure'), cleanupError = new Error('listener cleanup failure')
        let cleanupThrown = false
        const tracked = []
        const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document)
        document.addEventListener = function(type, callback, options) {
          if (['partial','partialcleanup'].includes('${scenario}') && type === 'pointercancel' && callback.name === 'cancel') throw setupError
          if (['pointerup','pointercancel'].includes(type) && options === true) tracked.push({type, callback, removed: false})
          return add(type, callback, options)
        }
        document.removeEventListener = function(type, callback, options) {
          tracked.filter(item => item.type === type && item.callback === callback && options === true).forEach(item => item.removed = true)
          const result = remove(type, callback, options)
          if (!cleanupThrown && type === 'pointerup' && callback.name === 'pointerUp' && ('${scenario}' === 'partialcleanup' || ('${scenario}' === 'hostcleanup' && new Error().stack?.includes('closeViewDisposers')))) { cleanupThrown = true; throw cleanupError }
          return result
        }
        const host = document.createElement('div'); document.body.append(host)
        const fail = Extension.create({name:'tableRegistryHostFailure', priority:1, addProseMirrorPlugins() {return [new Plugin({view() {throw hostError}})]}})
        let caught
        try { createEditor({element:host, extensions:[fail]}) } catch (error) { caught = error }
        const expected = ['host','hostcleanup'].includes('${scenario}') ? hostError : setupError
        const double = ['partialcleanup','hostcleanup'].includes('${scenario}')
        window.tableRegistryFailureProbe = {
          correct: double ? caught instanceof AggregateError && caught.cause === expected && caught.errors[0] === expected && caught.errors[1] === cleanupError : caught === expected,
          active: tracked.filter(item => !item.removed).length,
          shell: host.children.length,
          overlays: [...document.querySelectorAll('.semlo-editor-table-edges')].filter(node => !baseline.has(node)).length,
          baselineIntact: [...baseline].every(node => node.isConnected),
        }
      `,
    });
    await page.waitForFunction(() =>
      Boolean((window as unknown as { tableRegistryFailureProbe?: unknown }).tableRegistryFailureProbe),
    );
    const result = await page.evaluate(
      () => (window as unknown as { tableRegistryFailureProbe: unknown }).tableRegistryFailureProbe,
    );
    expect(result).toEqual({ correct: true, active: 0, shell: 0, overlays: 0, baselineIntact: true });
  });
}

for (const crossFrame of [false, true]) {
  test(`table registry keeps editors isolated across ${crossFrame ? "documents" : "instances"}`, async ({ page }) => {
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
        import { createEditor } from '/dist/index.js'
        const watch = doc => {
          const records = [], add = doc.addEventListener.bind(doc), remove = doc.removeEventListener.bind(doc)
          doc.addEventListener = function(type, callback, options) {
            if (type === 'pointercancel' && callback.name === 'cancel' && options === true) records.push({callback, removed:false})
            return add(type, callback, options)
          }
          doc.removeEventListener = function(type, callback, options) {
            if (type === 'pointercancel' && options === true) records.filter(item => item.callback === callback).forEach(item => item.removed = true)
            return remove(type, callback, options)
          }
          return () => records.filter(item => !item.removed).length
        }
        const mainCount = watch(document)
        const frame = ${crossFrame} ? document.createElement('iframe') : null
        if (frame) document.body.append(frame)
        const otherDocument = frame ? frame.contentDocument : document
        const otherCount = frame ? watch(otherDocument) : mainCount
        const mainBaseline = new Set(document.querySelectorAll('.semlo-editor-table-edges'))
        const otherBaseline = frame ? new Set(otherDocument.querySelectorAll('.semlo-editor-table-edges')) : mainBaseline
        const oneHost = document.createElement('div'); document.body.append(oneHost)
        const twoHost = otherDocument.createElement('div'); otherDocument.body.append(twoHost)
        const one = createEditor({element:oneHost, outline:false}), two = createEditor({element:twoHost, outline:false})
        const before = [mainCount(), otherCount()]
        one.destroy(); one.destroy()
        const afterOne = [mainCount(), otherCount()]
        two.destroy(); two.destroy()
        const afterBoth = [mainCount(), otherCount()]
        window.tableRegistryIsolationProbe = {
          before, afterOne, afterBoth,
          mainExtra: [...document.querySelectorAll('.semlo-editor-table-edges')].filter(node => !mainBaseline.has(node)).length,
          otherExtra: [...otherDocument.querySelectorAll('.semlo-editor-table-edges')].filter(node => !otherBaseline.has(node)).length,
          baselineIntact: [...mainBaseline, ...otherBaseline].every(node => node.isConnected),
        }
      `,
    });
    await page.waitForFunction(() =>
      Boolean((window as unknown as { tableRegistryIsolationProbe?: unknown }).tableRegistryIsolationProbe),
    );
    const result = await page.evaluate(
      () => (window as unknown as { tableRegistryIsolationProbe: unknown }).tableRegistryIsolationProbe,
    );
    expect(result).toEqual({
      before: crossFrame ? [1, 1] : [2, 2],
      afterOne: crossFrame ? [0, 1] : [1, 1],
      afterBoth: [0, 0],
      mainExtra: 0,
      otherExtra: 0,
      baselineIntact: true,
    });
  });
}

for (const axis of ["行", "列"] as const) {
  test(`host beforeTransaction replacement is rejected during ${axis} selection`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
    window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table><p>后文</p>' })
  `,
    });
    await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
    await page.locator("#table-navigation-test td").first().hover();
    const handle = page.getByRole("button", { name: `选择第 1 ${axis}` });
    await expect(handle).toBeVisible();
    const box = await handle.boundingBox();
    if (!box) throw new Error("Missing selection handle");
    const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
    await page.evaluate(() => {
      const controller = window.__semloRequireFixture("tableNavigationEditor");
      let done = false;
      controller.editor.on("beforeTransaction", ({ transaction }) => {
        if (done || transaction.selection.toJSON().type !== "cell") return;
        done = true;
        try {
          controller.setContent("<p>宿主新文档</p>");
        } catch (error) {
          Reflect.set(window, "tableRejection", (error as Error).name);
        }
      });
    });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    expect(await page.evaluate(() => Reflect.get(window, "tableRejection"))).toBe("ReentrantTransactionError");
    expect(await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json)).toEqual(
      before,
    );
    expect(errors).toEqual([]);
  });
}

test("host beforeTransaction replacement is rejected during resize-start", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'table-navigation-test'; host.style.width = '520px'; document.body.prepend(host)
    window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table><p>后文</p>' })
  `,
  });
  await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
  const before = await page.evaluate(() => window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json);
  const cell = page.locator("#table-navigation-test td").first();
  const box = await cell.boundingBox();
  if (!box) throw new Error("Missing cell");
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2);
  await expect(page.locator("#table-navigation-test .column-resize-handle").first()).toBeVisible();
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("tableNavigationEditor");
    const editor = controller.editor;
    const plugin = editor.state.plugins.find((p) =>
      (p as unknown as { key: string }).key.includes("tableColumnResizing"),
    )!;
    let done = false;
    editor.on("beforeTransaction", ({ transaction }) => {
      if (!done && transaction.getMeta(plugin)?.setDragging) {
        done = true;
        try {
          controller.setContent("<p>宿主新文档</p>");
        } catch (error) {
          Reflect.set(window, "tableRejection", (error as Error).name);
        }
      }
    });
    const tracked = new Set<EventListenerOrEventListenerObject>();
    const add = window.addEventListener,
      remove = window.removeEventListener;
    window.addEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === "mousemove" || type === "mouseup") tracked.add(listener);
      return add.call(window, type, listener, options);
    } as typeof window.addEventListener;
    window.removeEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) {
      tracked.delete(listener);
      return remove.call(window, type, listener, options);
    } as typeof window.removeEventListener;
    (window as unknown as { resizeListenerCount: () => number }).resizeListenerCount = () => tracked.size;
  });
  await page.mouse.down();
  const started = await page.evaluate(() => ({
    rejected: Reflect.get(window, "tableRejection"),
    json: window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json,
  }));
  expect(started).toEqual({ rejected: "ReentrantTransactionError", json: before });
  await page.mouse.up();
  const result = await page.evaluate(() => ({
    rejected: Reflect.get(window, "tableRejection"),
    json: window.__semloRequireFixture("tableNavigationEditor").getSnapshot().json,
    listeners: (window as unknown as { resizeListenerCount: () => number }).resizeListenerCount(),
  }));
  // 启动被中止后，松开鼠标也不能写入列宽。
  expect(result).toEqual({ rejected: "ReentrantTransactionError", json: before, listeners: 0 });
});

for (const framework of ["react", "vue", "solid"] as const) {
  test(`${framework} host beforeTransaction replacement is rejected during row selection`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
    await page.evaluate((name) => window.__semloRequireFixture("mountDynamicEditor").bind(window)(name), framework);
    await page.evaluate(() =>
      window
        .__semloRequireFixture("dynamicEditor")
        .controller.setContent(
          "<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table><p>后文</p>",
        ),
    );
    const before = await page.evaluate(
      () => window.__semloRequireFixture("dynamicEditor").controller.getSnapshot().json,
    );
    const host = page.locator("#dynamic-editor");
    await host.getByRole("cell", { name: "A", exact: true }).hover();
    const handle = page.getByRole("button", { name: "选择第 1 行" });
    await expect(handle).toBeVisible();
    const box = await handle.boundingBox();
    if (!box) throw new Error("Missing row handle");
    await page.evaluate(() => {
      const controller = window.__semloRequireFixture("dynamicEditor").controller;
      let done = false;
      controller.editor.on("beforeTransaction", ({ transaction }) => {
        if (done || transaction.selection.toJSON().type !== "cell") return;
        done = true;
        try {
          controller.setContent("<p>宿主新文档</p>");
        } catch (error) {
          Reflect.set(window, "tableRejection", (error as Error).name);
        }
      });
    });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    expect(await page.evaluate(() => Reflect.get(window, "tableRejection"))).toBe("ReentrantTransactionError");
    expect(
      await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").controller.getSnapshot().json),
    ).toEqual(before);
    expect(errors).toEqual([]);
  });
}

for (const axis of ["行", "列"] as const) {
  test(`host beforeTransaction replacement is rejected during ${axis} drag`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div'); host.id = 'table-navigation-test'; document.body.prepend(host)
      window.tableNavigationEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A1</td><td>A2</td><td>A3</td></tr><tr><td>B1</td><td>B2</td><td>B3</td></tr><tr><td>C1</td><td>C2</td><td>C3</td></tr></tbody></table>' })
    `,
    });
    await page.waitForFunction(() => Boolean(window.tableNavigationEditor));
    const beforeCells = await page.locator("#table-navigation-test td").allTextContents();
    await page.locator("#table-navigation-test td").first().hover();
    const from = page.getByRole("button", { name: `选择第 2 ${axis}` });
    const to = page.getByRole("button", { name: `选择第 3 ${axis}` });
    await expect(from).toBeVisible();
    await expect(to).toBeVisible();
    const source = await from.boundingBox(),
      target = await to.boundingBox();
    if (!source || !target) throw new Error("Missing selection handles");
    await page.evaluate(() => {
      const controller = window.__semloRequireFixture("tableNavigationEditor");
      let done = false;
      controller.editor.on("beforeTransaction", ({ transaction }) => {
        if (done || !transaction.docChanged) return;
        done = true;
        try {
          controller.setContent("<p>宿主新文档</p>");
        } catch (error) {
          Reflect.set(window, "tableRejection", (error as Error).name);
        }
      });
    });
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      axis === "行" ? target.x + target.width / 2 : target.x + target.width - 2,
      axis === "行" ? target.y + target.height - 2 : target.y + target.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();
    expect(await page.evaluate(() => Reflect.get(window, "tableRejection"))).toBe("ReentrantTransactionError");
    const afterCells = await page.locator("#table-navigation-test td").allTextContents();
    expect(afterCells).not.toEqual(beforeCells);
    expect(afterCells.sort()).toEqual(["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"]);
    await expect(page.locator(".semlo-editor-table-edge-indicator")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
