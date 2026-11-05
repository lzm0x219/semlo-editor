import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    mixedOrderedHeadingEditor?: EditorController;
    mixedOrderedHeadingChanges?: number;
  }
}

type Scenario = {
  name: string;
  html: string;
  from: string;
  to: string;
  headings: Array<{ text: string; marker: string | null }>;
  retained: string;
};

const scenarios: Scenario[] = [
  {
    name: "a list item followed by a paragraph",
    html: "<ol><li><p>列表甲</p></li><li><p>列表乙</p></li></ol><p>普通丙</p>",
    from: "列表乙",
    to: "普通丙",
    headings: [
      { text: "列表乙", marker: "1. " },
      { text: "普通丙", marker: "2. " },
    ],
    retained: "列表甲",
  },
  {
    name: "a paragraph followed by a list item",
    html: "<p>普通甲</p><ol><li><p>列表乙</p></li><li><p>列表丙</p></li></ol>",
    from: "普通甲",
    to: "列表乙",
    headings: [
      { text: "普通甲", marker: null },
      { text: "列表乙", marker: "1. " },
    ],
    retained: "列表丙",
  },
];

async function mount(page: Page, html: string) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'mixed-ordered-heading-test'
      document.body.append(host)
      window.mixedOrderedHeadingChanges = 0
      window.mixedOrderedHeadingEditor = createEditor({
        element: host, outline: false, content: ${JSON.stringify(html)},
        onChange: () => { window.mixedOrderedHeadingChanges++ },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.mixedOrderedHeadingEditor));
  return page.locator("#mixed-ordered-heading-test .semlo-editor-prose");
}

async function select(page: Page, fromText: string, toText: string, backward: boolean) {
  await page.evaluate(
    ({ fromText, toText, backward }) => {
      const editor = window.__semloRequireFixture("mixedOrderedHeadingEditor").editor;
      const positions = new Map<string, { from: number; to: number }>();
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock) positions.set(node.textContent, { from: pos + 1, to: pos + node.nodeSize - 1 });
      });
      const first = positions.get(fromText);
      const last = positions.get(toText);
      if (!first || !last) throw new Error("Missing selected blocks");
      editor.view.focus();
      editor.commands.setTextSelection({ from: backward ? last.to : first.from, to: backward ? first.from : last.to });
    },
    { fromText, toText, backward },
  );
}

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const controller = window.__semloRequireFixture("mixedOrderedHeadingEditor");
    const { state, view } = controller.editor;
    const selection = state.selection;
    return {
      json: controller.getSnapshot().json,
      changes: window.mixedOrderedHeadingChanges,
      text: state.doc.textBetween(selection.from, selection.to, "\n"),
      backward: selection.anchor > selection.head,
      focused: view.hasFocus(),
      anchorOffset: selection.$anchor.parentOffset,
      headOffset: selection.$head.parentOffset,
    };
  });
}

/** Inspect Chromium's actual rendered list marker instead of inferring it from attributes. */
async function listMarkers(page: Page): Promise<string[]> {
  const session = await page.context().newCDPSession(page);
  try {
    const { root } = await session.send("DOM.getDocument");
    const { nodeId } = await session.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: "#mixed-ordered-heading-test .semlo-editor-prose > ol",
    });
    const { node: list } = await session.send("DOM.describeNode", { nodeId });
    const { nodes } = await session.send("Accessibility.getFullAXTree");
    const start = nodes.find((entry) => entry.backendDOMNodeId === list.backendNodeId);
    if (!start) throw new Error("List is absent from the Chromium accessibility tree");
    const byId = new Map(nodes.map((entry) => [entry.nodeId, entry]));
    const markers: string[] = [];
    const visit = (id: string) => {
      const entry = byId.get(id);
      if (!entry) return;
      if (entry.role?.value === "ListMarker") markers.push(String(entry.name?.value ?? "").trim());
      entry.childIds?.forEach(visit);
    };
    visit(start.nodeId);
    return markers;
  } finally {
    await session.detach();
  }
}

for (const scenario of scenarios) {
  for (const backward of [false, true]) {
    test(`${scenario.name} converts atomically with ${backward ? "backward" : "forward"} selection`, async ({
      page,
    }) => {
      const prose = await mount(page, scenario.html);
      await select(page, scenario.from, scenario.to, backward);
      const before = await snapshot(page);
      expect(before.text).toBe(`${scenario.from}\n${scenario.to}`);
      expect(before.backward).toBe(backward);
      expect(before.focused).toBe(true);
      const originalRetained = before.json.content
        ?.find((node) => node.type === "orderedList")
        ?.content?.find((node) => node.content?.[0]?.content?.[0]?.text === scenario.retained);
      expect(originalRetained).toBeTruthy();

      await page.keyboard.press("ControlOrMeta+Alt+3");
      const headings = prose.locator(":scope > h3");
      await expect(headings).toHaveCount(2);
      for (const [index, expected] of scenario.headings.entries()) {
        await expect(headings.nth(index)).toContainText(expected.text);
        const marker = headings.nth(index).locator(".semlo-editor-heading-number");
        if (expected.marker === null) await expect(marker).toHaveCount(0);
        else await expect(marker).toHaveText(expected.marker);
      }
      const list = prose.locator(":scope > ol");
      await expect(list.locator(":scope > li")).toHaveCount(1);
      await expect(list.locator(":scope > li")).toHaveText(scenario.retained);
      await expect(list).not.toHaveAttribute("start", /^(?!1$).+/);
      expect(await listMarkers(page)).toEqual(["1."]);
      const after = await snapshot(page);
      expect(after.json.content?.find((node) => node.type === "orderedList")?.content?.[0]).toEqual(originalRetained);
      expect(after.text).toBe(before.text);
      expect(after.backward).toBe(backward);
      expect(after.focused).toBe(true);
      expect(after.anchorOffset).toBe(before.anchorOffset);
      expect(after.headOffset).toBe(before.headOffset);
      expect(after.changes).toBe((before.changes ?? 0) + 1);

      await page.keyboard.press("ControlOrMeta+z");
      const undone = await snapshot(page);
      expect(undone.json).toEqual(before.json);
      expect(undone.text).toBe(before.text);
      expect(undone.backward).toBe(backward);
      expect(undone.focused).toBe(true);
      expect(undone.anchorOffset).toBe(before.anchorOffset);
      expect(undone.headOffset).toBe(before.headOffset);

      await page.keyboard.press("ControlOrMeta+Shift+z");
      const redone = await snapshot(page);
      expect(redone.json).toEqual(after.json);
      expect(redone.text).toBe(before.text);
      expect(redone.backward).toBe(backward);
      expect(redone.focused).toBe(true);
      expect(redone.anchorOffset).toBe(before.anchorOffset);
      expect(redone.headOffset).toBe(before.headOffset);
    });
  }
}
