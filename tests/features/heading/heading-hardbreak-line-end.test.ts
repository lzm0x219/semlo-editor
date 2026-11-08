import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/heading/heading-hardbreak-line-end-fixture";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/heading/heading-hardbreak-line-end-fixture.ts"));
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

function documentFor(numbered: boolean): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 3, semloEditorHeadingNumbering: numbered ? "mixed" : null },
        content: [{ type: "text", text: "alpha" }, { type: "hardBreak" }, { type: "text", text: "beta" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "NEXT" }] },
    ],
  };
}
async function mount(
  page: Page,
  numbered: boolean,
  order: "early" | "late" = "early",
  value = documentFor(numbered),
  widget?: "src" | "size",
) {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountHardBreakLineEnd === "function");
  await page.evaluate(
    ({ content, order, widget }) => window.__semloRequireFixture("mountHardBreakLineEnd")(content, order, widget),
    {
      content: value,
      order,
      widget,
    },
  );
  await page.evaluate(() => window.__semloRequireFixture("hardBreakLineEnd").settle());
}
async function clickSide(page: Page, side: "before" | "after") {
  const point = await page.evaluate((side) => {
    const heading = document.querySelector("#heading-hardbreak-line-end h3");
    if (!heading) throw new Error("Missing heading");
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      if (!node.parentElement?.closest('[contenteditable="false"]')) nodes.push(node as Text);
    const node = nodes[side === "before" ? 0 : 1];
    if (!node?.data) throw new Error("Missing hardBreak text");
    const range = document.createRange();
    const offset = side === "before" ? node.length - 1 : 0;
    range.setStart(node, offset);
    range.setEnd(node, offset + 1);
    const r = range.getBoundingClientRect();
    return { x: side === "before" ? r.right + 2 : r.left + 1, y: (r.top + r.bottom) / 2 };
  }, side);
  await page.mouse.click(point.x, point.y);
}
async function read(page: Page) {
  return page.evaluate(() => {
    const fixture = window.__semloRequireFixture("hardBreakLineEnd");
    const { editor } = fixture.controller;
    const native = document.getSelection();
    const pm = editor.state.selection;
    return {
      json: editor.getJSON(),
      text: native?.toString(),
      dom: native?.anchorNode
        ? {
            anchor: editor.view.posAtDOM(native.anchorNode, native.anchorOffset),
            focus: native.focusNode ? editor.view.posAtDOM(native.focusNode, native.focusOffset) : null,
            collapsed: native.isCollapsed,
          }
        : null,
      pm: { anchor: pm.anchor, head: pm.head, empty: pm.empty },
      focused: editor.view.hasFocus(),
      prevented: window.__semloRequireFixture("hardBreakEndEvents").map((event) => event.defaultPrevented),
      rejected: fixture.rejected(),
      focusCalls: fixture.focusCalls(),
    };
  });
}

for (const numbered of [false, true]) {
  for (const immediate of [false, true]) {
    test(`${numbered ? "numbered" : "ordinary"} hardBreak line end: repeated Shift+End and Backspace ${immediate ? "immediately" : "after settle"}`, async ({
      page,
    }) => {
      await mount(page, numbered);
      await clickSide(page, "before");
      if (!immediate) await page.evaluate(() => window.__semloRequireFixture("hardBreakLineEnd").settle());
      const before = await read(page);
      expect(before.dom).toMatchObject({ anchor: 6, focus: 6, collapsed: true });
      await page.keyboard.press("Shift+End");
      await page.keyboard.press("Shift+End");
      await page.evaluate(() => window.__semloRequireFixture("hardBreakLineEnd").settle());
      const selected = await read(page);
      expect(selected.text).toBe("");
      expect(selected.dom).toMatchObject({ anchor: 6, focus: 6, collapsed: true });
      expect(selected.pm).toEqual({ anchor: 6, head: 6, empty: true });
      expect(selected.prevented).toEqual([true, true]);
      expect(selected.json).toEqual(before.json);
      expect(selected.focused).toBe(true);
      const expected = await page.evaluate(() => {
        const { state } = window.__semloRequireFixture("hardBreakLineEnd").controller.editor;
        return state.tr.delete(5, 6).doc.toJSON();
      });
      await page.keyboard.press("Backspace");
      const removed = await read(page);
      expect(removed.json).toEqual(expected);
      expect(removed.focused).toBe(true);
      await page.keyboard.press("ControlOrMeta+z");
      const undone = await read(page);
      expect(undone.json).toEqual(before.json);
      expect(undone.pm).toEqual({ anchor: 6, head: 6, empty: true });
    });
  }
  test(`${numbered ? "numbered" : "ordinary"} after hardBreak selects only second line`, async ({ page }) => {
    await mount(page, numbered);
    await clickSide(page, "after");
    await page.evaluate(() => window.__semloRequireFixture("hardBreakLineEnd").settle());
    const before = await read(page);
    expect(before.dom).toMatchObject({ anchor: 7, focus: 7, collapsed: true });
    await page.keyboard.press("Shift+End");
    await page.evaluate(() => window.__semloRequireFixture("hardBreakLineEnd").settle());
    const selected = await read(page);
    expect(selected.text).toBe("beta");
    expect(selected.dom).toMatchObject({ anchor: 7, focus: 11, collapsed: false });
    expect(selected.pm).toEqual({ anchor: 7, head: 11, empty: false });
    expect(selected.prevented).toEqual([true]);
    await page.keyboard.press("Backspace");
    const removed = await read(page);
    expect(removed.json.content?.at(-1)).toEqual(before.json.content?.at(-1));
    await page.keyboard.press("ControlOrMeta+z");
    expect((await read(page)).json).toEqual(before.json);
  });
}

for (const order of ["early", "late"] as const) {
  test(`${order} host rejection of synchronizing a stale hardBreak caret does not mutate the document`, async ({
    page,
  }) => {
    await mount(page, false, order);
    await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("hardBreakLineEnd");
      const editor = fixture.controller.editor;
      editor.view.focus();
      editor.commands.setTextSelection(2);
      const heading = editor.view.dom.querySelector("h3");
      if (!heading) throw new Error("Missing heading");
      const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
      let text = walker.nextNode();
      while (text && text.parentElement?.closest('[contenteditable="false"]')) text = walker.nextNode();
      if (!text) throw new Error("Missing text");
      fixture.armReject();
      // Inject the host's stale DOM selection during the key event, before
      // ProseMirror's observer has a chance to synchronize it.
      const target = text;
      const inject = (event: KeyboardEvent) => {
        if (event.key !== "End" || !event.shiftKey) return;
        document.getSelection()?.setBaseAndExtent(target, 5, target, 5);
        editor.view.dom.removeEventListener("keydown", inject, true);
      };
      editor.view.dom.addEventListener("keydown", inject, true);
    });
    const before = await read(page);
    expect(before.pm.anchor).toBe(2);
    expect(before.dom?.anchor).toBe(2);
    await page.keyboard.press("Shift+End");
    await page.evaluate(() => window.__semloRequireFixture("hardBreakLineEnd").settle());
    const after = await read(page);
    expect(after.prevented).toEqual([true]);
    // The candidate selection and the subsequent native DOMObserver retry
    // are both rejected by this host; neither is forced into the editor.
    expect(after.rejected).toBe(2);
    expect(after.json).toEqual(before.json);
    expect(after.pm).toEqual(before.pm);
    expect(after.dom).toEqual(before.dom);
    expect(after.focused).toBe(true);
    const expected = await page.evaluate(() => {
      const { state } = window.__semloRequireFixture("hardBreakLineEnd").controller.editor;
      return state.tr.insertText("X", 2).doc.toJSON();
    });
    await page.keyboard.insertText("X");
    await page.evaluate(() => window.__semloRequireFixture("hardBreakLineEnd").settle());
    expect((await read(page)).json).toEqual(expected);
    await page.keyboard.press("ControlOrMeta+z");
    expect((await read(page)).json).toEqual(before.json);
  });
}

for (const numbered of [false, true]) {
  for (const [name, nodes, offset] of [
    ["first empty line", [{ type: "hardBreak" }, { type: "hardBreak" }, { type: "text", text: "beta" }], 0],
    [
      "middle empty line",
      [{ type: "text", text: "alpha" }, { type: "hardBreak" }, { type: "hardBreak" }, { type: "text", text: "beta" }],
      6,
    ],
    ["trailing empty line", [{ type: "text", text: "alpha" }, { type: "hardBreak" }], 6],
    ["only hardBreaks", [{ type: "hardBreak" }, { type: "hardBreak" }], 1],
  ] as const) {
    test(`${numbered ? "numbered" : "ordinary"} ${name} keeps the selection collapsed`, async ({ page }) => {
      const content: JSONContent = {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 3, semloEditorHeadingNumbering: numbered ? "mixed" : null },
            content: [...nodes],
          },
          { type: "paragraph", content: [{ type: "text", text: "NEXT" }] },
        ],
      };
      await mount(page, numbered, "early", content);
      await page.evaluate((position) => {
        const editor = window.__semloRequireFixture("hardBreakLineEnd").controller.editor;
        editor.view.focus();
        editor.commands.setTextSelection(position);
      }, offset + 1);
      await page.evaluate(() => window.__semloRequireFixture("hardBreakLineEnd").settle());
      const before = await read(page);
      expect(before.pm).toEqual({ anchor: offset + 1, head: offset + 1, empty: true });
      await page.keyboard.press("Shift+End");
      const first = await read(page);
      expect(first.prevented).toEqual([true]);
      expect(first.dom).toMatchObject({ anchor: offset + 1, focus: offset + 1, collapsed: true });
      await page.keyboard.press("Shift+End");
      const selected = await read(page);
      expect(selected.json).toEqual(before.json);
      expect(selected.pm).toEqual(before.pm);
      expect(selected.dom).toMatchObject({ anchor: offset + 1, focus: offset + 1, collapsed: true });
      expect(selected.prevented).toEqual([true, true]);
      if (offset > 0) {
        const expected = await page.evaluate((position) => {
          const { state } = window.__semloRequireFixture("hardBreakLineEnd").controller.editor;
          return state.tr.delete(position - 1, position).doc.toJSON();
        }, offset + 1);
        await page.keyboard.press("Backspace");
        expect((await read(page)).json).toEqual(expected);
        await page.keyboard.press("ControlOrMeta+z");
        expect((await read(page)).json).toEqual(before.json);
      }
      await page.keyboard.insertText("X");
      const inserted = await read(page);
      expect(inserted.json.content?.at(-1)).toEqual(before.json.content?.at(-1));
      expect(inserted.focused).toBe(true);
      await page.keyboard.press("ControlOrMeta+z");
      expect((await read(page)).json).toEqual(before.json);
    });
  }
}

for (const widget of ["src", "size"] as const) {
  test(`host image widget resembling a separator with ${widget} keeps unverified line operations bounded`, async ({
    page,
  }) => {
    const content: JSONContent = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 3 },
          content: [{ type: "hardBreak" }, { type: "hardBreak" }, { type: "text", text: "beta" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "NEXT" }] },
      ],
    };
    await mount(page, false, "early", content, widget);
    await page.evaluate(() => {
      const editor = window.__semloRequireFixture("hardBreakLineEnd").controller.editor;
      editor.view.focus();
      editor.commands.setTextSelection(1);
    });
    await page.evaluate(() => window.__semloRequireFixture("hardBreakLineEnd").settle());
    const hostImage = page.locator("#heading-hardbreak-line-end h3 img.ProseMirror-separator.ProseMirror-widget");
    await expect(hostImage).toHaveCount(1);
    if (widget === "src") await expect(hostImage).toHaveAttribute("src", /^data:image\/svg\+xml/);
    else await expect(hostImage).toHaveAttribute("width", "16");
    const before = await read(page);
    await page.evaluate(() => {
      window.__semloRequireFixture("hardBreakLineEnd").controller.editor.commands.setTextSelection(4);
    });
    const interior = await read(page);
    await page.keyboard.press("Home");
    const home = await read(page);
    // 外观相似的宿主 widget 使整段布局无法验证，不能借 hardBreak 猜测行首。
    expect(home.json).toEqual(interior.json);
    expect(home.pm).toEqual(interior.pm);
    expect(home.dom).toEqual(interior.dom);
    await page.evaluate(() => {
      window.__semloRequireFixture("hardBreakLineEnd").controller.editor.commands.setTextSelection(1);
    });
    await page.keyboard.press("Shift+End");
    const after = await read(page);
    expect(after.prevented).toEqual([true]);
    expect(after.json).toEqual(before.json);
    expect(after.pm).toEqual(before.pm);
    expect(after.dom).toEqual(before.dom);
    await expect(hostImage).toHaveCount(1);
  });
}

for (const order of ["early", "late"] as const) {
  test(`${order} hardBreak Home respects host rejection and the transaction reentry guard`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mount(page, false, order);
    await page.evaluate(() => {
      const editor = window.__semloRequireFixture("hardBreakLineEnd").controller.editor;
      editor.view.focus();
      editor.commands.setTextSelection(8);
      Reflect.set(window, "hardBreakHomeEvents", []);
      editor.view.dom.addEventListener("keydown", (event) => {
        if (event.key === "Home")
          Reflect.get(window, "hardBreakHomeEvents").push({
            prevented: event.defaultPrevented,
            trusted: event.isTrusted,
          });
      });
    });
    await page.evaluate(() => window.__semloRequireFixture("hardBreakLineEnd").settle());
    const before = await read(page);
    const expected = await page.evaluate(() => {
      const { state } = window.__semloRequireFixture("hardBreakLineEnd").controller.editor;
      return state.tr.delete(7, 8).doc.toJSON();
    });
    await page.evaluate(() => window.__semloRequireFixture("hardBreakLineEnd").armReject());
    await page.keyboard.press("Home");
    const rejected = await read(page);
    expect(rejected.rejected).toBe(before.rejected + 1);
    expect(rejected.pm).toEqual(before.pm);
    expect(rejected.dom).toEqual(before.dom);
    expect(rejected.json).toEqual(before.json);
    expect(rejected.focusCalls).toBe(0);
    await page.keyboard.press("Backspace");
    expect((await read(page)).json).toEqual(expected);
    await page.keyboard.press("ControlOrMeta+z");
    expect((await read(page)).json).toEqual(before.json);
    await page.evaluate(() => window.__semloRequireFixture("hardBreakLineEnd").armReject("reenter-selection"));
    await page.keyboard.press("Home");
    const afterReentry = await read(page);
    expect(afterReentry.json).toEqual(before.json);
    expect(afterReentry.pm).toEqual(before.pm);
    expect(afterReentry.dom).toEqual(before.dom);
    expect(afterReentry.focusCalls).toBe(0);
    expect(errors).toEqual(["A transaction cannot be dispatched before the current transaction commits"]);
    expect(await page.evaluate(() => Reflect.get(window, "hardBreakHomeEvents"))).toEqual([
      { prevented: true, trusted: true },
      { prevented: true, trusted: true },
    ]);
  });
}

for (const order of ["early", "late"] as const) {
  for (const effect of ["reenter-selection", "reenter-doc", "blur", "destroy"] as const) {
    test(`${order} host ${effect} during rejection is respected without forcing focus`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await mount(page, false, order);
      const before = await page.evaluate(() =>
        window.__semloRequireFixture("hardBreakLineEnd").controller.editor.getJSON(),
      );
      await page.evaluate((effect) => {
        const fixture = window.__semloRequireFixture("hardBreakLineEnd");
        const editor = fixture.controller.editor;
        editor.view.focus();
        editor.commands.setTextSelection(2);
        Reflect.set(window, "hardBreakBlurCount", 0);
        editor.on("blur", () =>
          Reflect.set(window, "hardBreakBlurCount", Reflect.get(window, "hardBreakBlurCount") + 1),
        );
        const heading = editor.view.dom.querySelector("h3")!;
        const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
        let text = walker.nextNode();
        while (text && text.parentElement?.closest('[contenteditable="false"]')) text = walker.nextNode();
        if (!text) throw new Error("Missing text");
        const target = text;
        fixture.armReject(effect);
        const inject = (event: KeyboardEvent) => {
          if (event.key !== "End" || !event.shiftKey) return;
          document.getSelection()?.setBaseAndExtent(target, 5, target, 5);
          editor.view.dom.removeEventListener("keydown", inject, true);
        };
        editor.view.dom.addEventListener("keydown", inject, true);
      }, effect);
      await page.keyboard.press("Shift+End");
      const outcome = await page.evaluate(() => {
        const fixture = window.__semloRequireFixture("hardBreakLineEnd");
        const editor = fixture.controller.editor;
        return {
          destroyed: editor.isDestroyed,
          focusCalls: fixture.focusCalls(),
          rejected: fixture.rejected(),
          prevented: window.__semloRequireFixture("hardBreakEndEvents").map((event) => event.defaultPrevented),
          active: document.activeElement?.id,
          focused: editor.isFocused,
          blurCount: Reflect.get(window, "hardBreakBlurCount"),
          json: editor.isDestroyed ? null : editor.getJSON(),
          selection: editor.isDestroyed ? null : editor.state.selection.toJSON(),
        };
      });
      expect(outcome.rejected).toBe(1);
      expect(outcome.prevented).toEqual([true]);
      expect(outcome.focusCalls).toBe(0);
      if (effect === "destroy") expect(outcome.destroyed).toBe(true);
      if (effect === "blur") {
        expect(outcome.active).toBe("hardbreak-outside-focus");
        expect(outcome.focused).toBe(false);
        expect(outcome.blurCount).toBe(1);
      }
      if (effect !== "destroy") expect(outcome.json).toEqual(before);
      if (effect === "reenter-selection") expect(outcome.selection).not.toMatchObject({ anchor: 3, head: 3 });
      expect(errors).toEqual(
        effect === "reenter-selection" || effect === "reenter-doc"
          ? ["A transaction cannot be dispatched before the current transaction commits"]
          : [],
      );
    });
  }
}

test("H2 soft-line deletion keeps following text and restores selection on undo", async ({ page }) => {
  const content: JSONContent = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "甲乙丙" }, { type: "hardBreak" }, { type: "text", text: "丁戊己" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "后文甲乙" }] },
    ],
  };
  await mount(page, false, "early", content);
  const original = (await read(page)).json;
  const select = async (from: number, to = from) => {
    await page.evaluate(
      ({ from, to }) => {
        const fixture = window.__semloRequireFixture("hardBreakLineEnd");
        fixture.controller.editor.commands.setTextSelection({ from, to });
        fixture.controller.editor.view.focus();
      },
      { from, to },
    );
    await page.evaluate(() => window.__semloRequireFixture("hardBreakLineEnd").settle());
  };
  await select(2, 6);
  expect((await read(page)).text).toBe("乙丙\n丁");
  await page.keyboard.press("Backspace");
  let after = (await read(page)).json;
  expect(after.content?.[0].content).toEqual([{ type: "text", text: "甲戊己" }]);
  expect(after.content?.[1].content).toEqual([{ type: "text", text: "后文甲乙" }]);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await read(page)).json).toEqual(original);
  expect((await read(page)).text).toBe("乙丙\n丁");
  await select(5, 8);
  await page.keyboard.press("Backspace");
  after = (await read(page)).json;
  expect(after.content?.[0].content).toEqual([{ type: "text", text: "甲乙丙" }, { type: "hardBreak" }]);
  expect(after.content?.[1].content).toEqual([{ type: "text", text: "后文甲乙" }]);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await read(page)).json).toEqual(original);
  await select(5);
  await page.keyboard.press("Backspace");
  after = (await read(page)).json;
  expect(after.content?.[0].content).toEqual([{ type: "text", text: "甲乙丙丁戊己" }]);
  expect(after.content?.[1].content).toEqual([{ type: "text", text: "后文甲乙" }]);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await read(page)).json).toEqual(original);
});
