import { resolve } from "node:path";

import { createRsbuild } from "@rsbuild/core";
import { expect, test, type Page } from "@rstest/playwright";
import type { EditorContent } from "@semlo-editor/core";

import {
  mixedRomanContent,
  mixedRomanSequenceContent,
  observedMixedRoman,
} from "../../fixtures/list/list-mixed-roman-content";
import type {} from "../../fixtures/list/list-mixed-roman-fixture";

let origin: string;
let close: (() => Promise<void>) | undefined;
test.beforeAll(async () => {
  const build = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/list/list-mixed-roman-fixture.ts" } },
      resolve: {
        alias: {
          "@semlo-editor/core$": resolve("packages/core/dist/index.js"),
          "@semlo-editor/core/style.css": resolve("packages/core/dist/style.css"),
        },
      },
      server: { host: "127.0.0.1", port: 0, strictPort: true, publicDir: false },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await build.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  close = () => server.close();
});
test.afterAll(async () => close?.());
test.beforeEach(async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.mixedRomanFixture));
});
test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.mixedRomanFixture?.destroy());
  await expect(page.locator(".semlo-editor-prose")).toHaveCount(0);
});

async function markers(page: Page, selector = "#primary") {
  const session = await page.context().newCDPSession(page);
  try {
    const { root } = await session.send("DOM.getDocument");
    const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    const { node } = await session.send("DOM.describeNode", { nodeId });
    const { nodes } = await session.send("Accessibility.getFullAXTree");
    const container = nodes.find((entry) => entry.backendDOMNodeId === node.backendNodeId);
    if (!container) throw new Error("列表不在浏览器可访问树中");
    const byId = new Map(nodes.map((entry) => [entry.nodeId, entry]));
    const result: string[] = [];
    const visit = (id: string) => {
      const entry = byId.get(id);
      if (!entry) return;
      if (entry.role?.value === "ListMarker") result.push(String(entry.name?.value ?? "").trim());
      entry.childIds?.forEach(visit);
    };
    visit(container.nodeId);
    return result;
  } finally {
    await session.detach();
  }
}

const snapshot = (page: Page) => page.evaluate(() => window.mixedRomanFixture.get().getSnapshot());

async function mount(page: Page, content: EditorContent, echo: "json" | "html" | null = null) {
  await page.evaluate(({ content, echo }) => window.mixedRomanFixture.mount("primary", content, echo), {
    content,
    echo,
  });
}

async function select(page: Page, first: string, last: string, slot: "primary" | "secondary" = "primary") {
  await page.evaluate(
    ({ first, last, slot }) => {
      const editor = window.mixedRomanFixture.get(slot).editor;
      let from = -1,
        to = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "paragraph" && node.textContent === first) from = pos + 1;
        if (node.type.name === "paragraph" && node.textContent === last) to = pos + 1 + node.content.size;
      });
      if (from < 0 || to < 0) throw new Error("未找到目标正文");
      editor.commands.setTextSelection({ from, to });
      editor.commands.focus();
    },
    { first, last, slot },
  );
  await expect(page.locator(`#${slot} .semlo-editor-prose`)).toBeFocused();
}

test("构建后的CSS真实生成1至100混合Roman，旧JSON及静态HTML往返一致", async ({ page }) => {
  const before = await snapshot(page);
  const rendered = await markers(page);
  expect(rendered).toHaveLength(100);
  for (const [value, label] of observedMixedRoman) expect(rendered[value - 1]).toBe(`${label}.`);
  const items = page.locator("#primary ol > li");
  await expect(items.first()).toHaveCSS("list-style-type", "semlo-mixed-roman");
  const markerStyle = await items.first().evaluate((item) => {
    const style = getComputedStyle(item, "::marker");
    return { visibility: style.visibility, opacity: style.opacity, fontSize: parseFloat(style.fontSize) };
  });
  expect(markerStyle).toMatchObject({ visibility: "visible", opacity: "1" });
  expect(markerStyle.fontSize).toBeGreaterThan(0);
  expect(await items.evaluateAll((nodes) => nodes.map((node) => (node as HTMLLIElement).value))).toEqual(
    Array.from({ length: 100 }, (_, index) => index + 1),
  );
  await items.last().scrollIntoViewIfNeeded();
  await expect(items.last()).toBeInViewport();
  expect(before.text).not.toMatch(/[ⅰ-ⅸ]/);
  expect(JSON.stringify(before.json)).not.toContain("ordered-marker");
  await page.evaluate((html) => {
    document.getElementById("reader")!.innerHTML = html;
  }, before.html);
  expect(await markers(page, "#reader")).toEqual(rendered);
  await page.evaluate((content) => window.mixedRomanFixture.mount("secondary", content, null, false), before.html);
  expect(await page.evaluate(() => window.mixedRomanFixture.get("secondary").getSnapshot().json)).toEqual(before.json);
  expect(await markers(page, "#secondary")).toEqual(rendered);
  await page.evaluate((json) => window.mixedRomanFixture.get().setContent(json), before.json);
  expect(await snapshot(page)).toEqual(before);
});

test("系统plain剪贴板保留四格和1至13源标签，复制不改registry/正文/历史", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await mount(page, mixedRomanSequenceContent());
  const before = await snapshot(page);
  await select(page, "项1", "项13");
  await page.keyboard.press("ControlOrMeta+c");
  const plain = await page.evaluate(() => navigator.clipboard.readText());
  expect(plain).toBe(
    observedMixedRoman
      .slice(0, 13)
      .map(([value, label]) => `    ${label}. 项${value}`)
      .join("\n"),
  );
  expect(await snapshot(page)).toEqual(before);
  expect(await page.evaluate(() => window.mixedRomanFixture.get().editor.commands.undo())).toBe(false);
});

test("显式i/I旧HTML保持ASCII Roman，与默认混合及其他样式区分", async ({ page }) => {
  const html =
    '<ol start="13" type="i"><li data-semlo-editor-list-indent="2"><p>小写</p></li></ol>' +
    '<ol start="13" type="I"><li data-semlo-editor-list-indent="2"><p>大写</p></li></ol>';
  await page.evaluate((value) => {
    document.getElementById("reader")!.innerHTML = value;
  }, html);
  // 旧base.css的通用indent规则覆盖raw type=I；本叶不顺带修正该旧表现。
  expect(await markers(page, "#reader")).toEqual(["xiii.", "xiii."]);
  await mount(page, html);
  const before = await snapshot(page);
  expect(await markers(page)).toEqual(["xiii.", "XIII."]);
  await page.evaluate((html) => {
    document.getElementById("reader")!.innerHTML = html;
  }, before.html);
  expect(await markers(page, "#reader")).toEqual(["xiii.", "XIII."]);
  await page.evaluate((html) => window.mixedRomanFixture.get().setContent(html), before.html);
  expect((await snapshot(page)).json).toEqual(before.json);
  expect(await markers(page)).toEqual(["xiii.", "XIII."]);
  await mount(
    page,
    '<ol start="13"><li value="13" data-semlo-editor-list-indent="2" data-semlo-editor-ordered-marker="lower-roman"><p>项13</p></li></ol>',
  );
  expect(await markers(page)).toEqual(["Xⅲ."]);
  expect((await snapshot(page)).html).toContain('data-semlo-editor-ordered-marker="semlo-mixed-roman"');
  // 超过100未作原生对照；这里只验证项目扩展与CSS范围回退的契约。
  for (const [value, expected] of [
    [101, "Cⅰ."],
    [3999, "MMMCMXCⅸ."],
    [0, "0."],
    [4000, "4000."],
  ] as const) {
    await mount(page, mixedRomanContent(1, value));
    expect(await markers(page)).toEqual([expected]);
  }
});

test("raw静态type与非mixed/未知style保留旧CSS表现，仅无type默认mixed采用新字符", async ({ page }) => {
  const rows = [
    ...["1", "a", "A", "i", "I"].map(
      (type) => `<ol type="${type}"><li value="13" data-semlo-editor-list-indent="2"><p>raw ${type}</p></li></ol>`,
    ),
    ...["decimal", "chinese", "unknown", ""].map(
      (style) =>
        `<ol data-semlo-editor-ordered-style="${style}"><li value="13" data-semlo-editor-list-indent="2"><p>raw ${style}</p></li></ol>`,
    ),
    '<ol><li value="13" data-semlo-editor-list-indent="2"><p>default</p></li></ol>',
    '<ol data-semlo-editor-ordered-style="mixed"><li value="13" data-semlo-editor-list-indent="2"><p>mixed</p></li></ol>',
  ];
  await page.evaluate((html) => {
    document.getElementById("reader")!.innerHTML = html;
  }, rows.join(""));
  expect(await markers(page, "#reader")).toEqual([
    "xiii.",
    "xiii.",
    "xiii.",
    "xiii.",
    "xiii.",
    "xiii.",
    "xiii.",
    "xiii.",
    "xiii.",
    "Xⅲ.",
    "Xⅲ.",
  ]);
});

test("受控精确回写下编辑和单步历史不改项号，独立只读实例及重挂不串联", async ({ page }) => {
  await mount(page, mixedRomanSequenceContent(3, 11), "html");
  await page.evaluate(
    (content) => window.mixedRomanFixture.mount("secondary", content, null, false),
    mixedRomanContent(1, 44),
  );
  const untouched = await page.evaluate(() => window.mixedRomanFixture.get("secondary").getSnapshot());
  const before = await snapshot(page);
  await page.locator("#primary li p").first().click();
  await page.keyboard.press("End");
  await page.keyboard.type("编辑");
  const after = await snapshot(page);
  expect(after.text).toContain("项11编辑");
  expect(await markers(page)).toEqual(["Xⅰ.", "Xⅱ.", "Xⅲ."]);
  expect(after.json.content![0].attrs).toEqual(before.json.content![0].attrs);
  expect(await page.evaluate(() => window.mixedRomanFixture.get().editor.commands.undo())).toBe(true);
  expect(await snapshot(page)).toEqual(before);
  expect(await page.evaluate(() => window.mixedRomanFixture.get().editor.commands.redo())).toBe(true);
  expect(await snapshot(page)).toEqual(after);
  await expect(page.locator("#secondary .semlo-editor-prose")).toHaveAttribute("contenteditable", "false");
  expect(await markers(page, "#secondary")).toEqual(["XLⅳ."]);
  expect(await page.evaluate(() => window.mixedRomanFixture.get("secondary").getSnapshot())).toEqual(untouched);
  await mount(page, before.json);
  expect(await snapshot(page)).toEqual(before);
  expect(await markers(page)).toEqual(["Xⅰ.", "Xⅱ.", "Xⅲ."]);
  expect(await page.evaluate(() => window.mixedRomanFixture.get().editor.commands.undo())).toBe(false);
});
