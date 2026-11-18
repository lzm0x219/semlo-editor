import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(({ page }) => installFixtureGuards(page));

test("multiple browser bundles register table code boundary only once", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
  await page.addScriptTag({ type: "module", url: "/tests/code-block-preferences-fixture.js" });
  await page.waitForFunction(() => Boolean(window.mountCodePreferencesFixture));
  expect(errors).toEqual([]);
});

for (const framework of ["core", "react", "vue", "solid"] as const) {
  test(`${framework} table code boundary preserves its type across bundles and serialization`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
    await page.addScriptTag({ type: "module", url: "/tests/code-block-preferences-fixture.js" });
    await page.waitForFunction(() => Boolean(window.mountCodePreferencesFixture));
    await page.evaluate(async (framework) => {
      await window.__semloRequireFixture("mountDynamicEditor")("react");
      await window.__semloRequireFixture("mountCodePreferencesFixture")(framework, "bundle-secondary");
      const first = window.__semloRequireFixture("dynamicEditor").controller;
      const second = window.__semloRequireValue(
        window.__semloRequireFixture("codePreferencesFixtures")["bundle-secondary"],
        "fixture",
      ).controller;
      const content = "<table><tbody><tr><td>A</td><td><pre><code>alpha</code></pre></td></tr></tbody></table>";
      first.setContent(content);
      second.setContent(content);
      const paragraph = document.querySelector("#dynamic-editor td p")!;
      first.editor.view.focus();
      first.editor.commands.setTextSelection(first.editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
    }, framework);
    await page.keyboard.press("Tab");
    await page.keyboard.press("ArrowRight");
    await page.evaluate(() => {
      const first = window.__semloRequireFixture("dynamicEditor").controller.editor;
      (window as unknown as { firstBoundaryType: Function }).firstBoundaryType = first.state.selection.constructor;
      const second = window.__semloRequireValue(
        window.__semloRequireFixture("codePreferencesFixtures")["bundle-secondary"],
        "fixture",
      ).controller.editor;
      const paragraph = document.querySelector("#bundle-secondary td p")!;
      second.view.focus();
      second.commands.setTextSelection(second.view.posAtDOM(paragraph, paragraph.childNodes.length));
    });
    await page.keyboard.press("Tab");
    await page.keyboard.press("ArrowRight");
    const result = await page.evaluate(() => {
      const editor = window.__semloRequireValue(
        window.__semloRequireFixture("codePreferencesFixtures")["bundle-secondary"],
        "fixture",
      ).controller.editor;
      const selection = editor.state.selection;
      const State = editor.state.constructor as typeof import("@tiptap/pm/state").EditorState;
      const decoded = State.fromJSON(
        { schema: editor.state.schema, plugins: editor.state.plugins },
        editor.state.toJSON(),
      ).selection;
      const firstType = (window as unknown as { firstBoundaryType: Function }).firstBoundaryType;
      const result = {
        type: selection.toJSON().type,
        sameAcrossBundles: firstType === selection.constructor,
        sameAfterDecode: decoded.constructor === selection.constructor,
        equalAfterDecode: decoded.eq(selection),
      };
      editor.view.dispatch(editor.state.tr.setSelection(decoded.getBookmark().resolve(editor.state.doc)));
      return result;
    });
    expect(result).toEqual({
      type: "semloEditorTableCodeBoundary",
      sameAcrossBundles: true,
      sameAfterDecode: true,
      equalAfterDecode: true,
    });
    await page.keyboard.type("x");
    await expect(page.locator("#bundle-secondary td").last().locator("pre code")).toHaveText("alpha");
    await expect(page.locator("#bundle-secondary td").last().locator("p")).toHaveText("x");
    await expect(page.locator("#dynamic-editor td").last().locator("pre code")).toHaveText("alpha");
    await expect(page.locator("#dynamic-editor td").last().locator("p")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("browser bundles also initialize when the preferences entry loads first", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/tests/controlled.js", (route) => route.abort());
  await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
  await page.unroute("**/tests/controlled.js");
  await page.addScriptTag({ type: "module", url: "/tests/code-block-preferences-fixture.js" });
  await page.waitForFunction(() => Boolean(window.mountCodePreferencesFixture));
  await page.addScriptTag({ type: "module", url: "/tests/controlled.js" });
  await page.waitForFunction(() => Boolean(window.mountDynamicEditor));
  await page.evaluate(async () => {
    await window.__semloRequireFixture("mountCodePreferencesFixture")("core", "pref-first");
    await window.__semloRequireFixture("mountDynamicEditor")("react");
  });
  await page.evaluate(() => {
    const first = window.__semloRequireValue(
      window.__semloRequireFixture("codePreferencesFixtures")["pref-first"],
      "fixture",
    ).controller;
    const second = window.__semloRequireFixture("dynamicEditor").controller;
    const content = "<table><tbody><tr><td>A</td><td><pre><code>alpha</code></pre></td></tr></tbody></table>";
    first.setContent(content);
    second.setContent(content);
    const paragraph = document.querySelector("#pref-first td p")!;
    first.editor.view.focus();
    first.editor.commands.setTextSelection(first.editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
  });
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowRight");
  await page.evaluate(() => {
    const first = window.__semloRequireValue(
      window.__semloRequireFixture("codePreferencesFixtures")["pref-first"],
      "fixture",
    ).controller.editor;
    (window as unknown as { firstBoundaryType: Function }).firstBoundaryType = first.state.selection.constructor;
    const second = window.__semloRequireFixture("dynamicEditor").controller.editor;
    const paragraph = document.querySelector("#dynamic-editor td p")!;
    second.view.focus();
    second.commands.setTextSelection(second.view.posAtDOM(paragraph, paragraph.childNodes.length));
  });
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowRight");
  const result = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("dynamicEditor").controller.editor;
    const selection = editor.state.selection;
    const State = editor.state.constructor as typeof import("@tiptap/pm/state").EditorState;
    const decoded = State.fromJSON(
      { schema: editor.state.schema, plugins: editor.state.plugins },
      editor.state.toJSON(),
    ).selection;
    const firstType = (window as unknown as { firstBoundaryType: Function }).firstBoundaryType;
    const result = {
      type: selection.toJSON().type,
      sameAcrossBundles: firstType === selection.constructor,
      sameAfterDecode: decoded.constructor === selection.constructor,
      equalAfterDecode: decoded.eq(selection),
    };
    editor.view.dispatch(editor.state.tr.setSelection(decoded.getBookmark().resolve(editor.state.doc)));
    return result;
  });
  expect(result).toEqual({
    type: "semloEditorTableCodeBoundary",
    sameAcrossBundles: true,
    sameAfterDecode: true,
    equalAfterDecode: true,
  });
  await page.keyboard.type("x");
  await expect(page.locator("#dynamic-editor td").last().locator("pre code")).toHaveText("alpha");
  await expect(page.locator("#dynamic-editor td").last().locator("p")).toHaveText("x");
  await expect(page.locator("#pref-first td").last().locator("p")).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const framework of ["react", "vue", "solid"] as const) {
  test(`${framework} controller destruction after table drag unmount is safe`, async ({ page }) => {
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
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + 25, box.y + box.height / 2, { steps: 4 });
    const result = await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("dynamicEditor");
      const controller = fixture.controller;
      fixture.destroy();
      try {
        controller.destroy();
        return { destroyed: controller.editor.isDestroyed, error: null };
      } catch (error) {
        return {
          destroyed: controller.editor.isDestroyed,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
    await page.mouse.up();
    expect(result).toEqual({ destroyed: true, error: null });
    expect(errors).toEqual([]);
  });
}

test("table boundary registration and state stay isolated across iframes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
  await page.evaluate(() => {
    for (const name of ["table-frame-one", "table-frame-two"]) {
      const frame = document.createElement("iframe");
      frame.id = name;
      frame.name = name;
      frame.src = "/tests/controlled.html";
      frame.style.cssText = "width:800px;height:400px";
      document.body.append(frame);
    }
  });
  await expect
    .poll(() => Boolean(page.frame({ name: "table-frame-one" }) && page.frame({ name: "table-frame-two" })))
    .toBe(true);
  const first = page.frame({ name: "table-frame-one" });
  const second = page.frame({ name: "table-frame-two" });
  if (!first || !second) throw new Error("Missing table iframes");
  for (const frame of [first, second]) {
    await frame.waitForFunction(() => Boolean(window.mountDynamicEditor));
    await frame.addScriptTag({ type: "module", url: "/tests/code-block-preferences-fixture.js" });
    await frame.waitForFunction(() => Boolean(window.mountCodePreferencesFixture));
    await frame.evaluate(async () => {
      await window.__semloRequireFixture("mountDynamicEditor")("react");
      const editor = window.__semloRequireFixture("dynamicEditor").controller.editor;
      window
        .__semloRequireFixture("dynamicEditor")
        .controller.setContent(
          "<table><tbody><tr><td>A</td><td><pre><code>alpha</code></pre></td></tr></tbody></table>",
        );
      const paragraph = document.querySelector("#dynamic-editor td p")!;
      editor.view.focus();
      editor.commands.setTextSelection(editor.view.posAtDOM(paragraph, paragraph.childNodes.length));
    });
    await page.keyboard.press("Tab");
    await page.keyboard.press("ArrowRight");
    await frame.evaluate(() => {
      const editor = window.__semloRequireFixture("dynamicEditor").controller.editor;
      (window as unknown as { frameBoundaryType: Function }).frameBoundaryType = editor.state.selection.constructor;
    });
  }
  const classesDiffer = await page.evaluate(() => {
    const first = document.querySelector<HTMLIFrameElement>("#table-frame-one")!.contentWindow as unknown as {
      frameBoundaryType: Function;
    };
    const second = document.querySelector<HTMLIFrameElement>("#table-frame-two")!.contentWindow as unknown as {
      frameBoundaryType: Function;
    };
    return first.frameBoundaryType !== second.frameBoundaryType;
  });
  expect(classesDiffer).toBe(true);
  await page.keyboard.type("x");
  await expect(page.frameLocator("#table-frame-two").locator("#dynamic-editor td").last().locator("p")).toHaveText("x");
  await expect(page.frameLocator("#table-frame-one").locator("#dynamic-editor td").last().locator("p")).toHaveCount(0);
  expect(errors).toEqual([]);
});
