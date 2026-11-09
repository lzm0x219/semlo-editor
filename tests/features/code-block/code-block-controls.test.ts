import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

const observedLanguages = [
  "Plain Text",
  "ABAP",
  "Agda",
  "ArkTS",
  "Asm",
  "Bash",
  "Basic",
  "C",
  "C#",
  "C++",
  "Clojure",
  "CMake",
  "CSS",
  "Cypher",
  "Dart",
  "Diff",
  "Dockerfile",
  "Erlang",
  "F#",
  "Fortran",
  "Git",
  "Glsl",
  "Go",
  "GraphQL",
  "Groovy",
  "Haskell",
  "HTML",
  "HTTP",
  "Java",
  "JavaScript",
  "JSON",
  "JSX",
  "Julia",
  "KaTeX",
  "Kotlin",
  "LaTeX",
  "Less",
  "Lisp",
  "Lua",
  "Makefile",
  "Markdown",
  "MATLAB",
  "Nginx",
  "Objective-C",
  "OCaml",
  "Pascal",
  "Perl",
  "PHP",
  "PL/SQL",
  "PowerShell",
  "Properties",
  "Protobuf",
  "Python",
  "R",
  "Ruby",
  "Rust",
  "Sass",
  "Scala",
  "Scheme",
  "Shell",
  "Solidity",
  "SQL",
  "sTeX",
  "Swift",
  "SystemVerilog",
  "Tcl",
  "TOML",
  "TSX",
  "TypeScript",
  "VB.net",
  "Velocity",
  "Verilog",
  "Vue",
  "XML",
  "YAML",
];

declare global {
  interface Window {
    codeControlsEditor?: EditorController;
    secondCodeControlsEditor?: EditorController;
  }
}

async function mount(page: Page) {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'code-controls-test'
      host.style.width = '800px'
      document.body.append(host)
      window.codeControlsEditor = createEditor({
        element: host,
        outline: false,
        content: '<pre data-theme="light"><code class="language-typescript">const value: string = "hello"</code></pre>',
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.codeControlsEditor));
  const host = page.locator("#code-controls-test");
  await host.locator(".semlo-editor-code-card").first().hover();
  return host;
}

test("language search opens in the header, reveals the current option and returns to the code", async ({ page }) => {
  const host = await mount(page);
  const card = host.locator(".semlo-editor-code-card");
  const code = card.locator("code");
  const language = card.getByRole("button", { name: "代码语言" });
  await code.click();
  await expect(card).toHaveClass(/is-active/);
  await page.waitForTimeout(600);
  await expect(card).toHaveClass(/is-active/);
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.waitForFunction(() => !window.__semloRequireFixture("codeControlsEditor").editor.state.selection.empty);
  const before = await page.evaluate(() => ({
    from: window.__semloRequireFixture("codeControlsEditor").editor.state.selection.from,
    to: window.__semloRequireFixture("codeControlsEditor").editor.state.selection.to,
  }));
  const languageBefore = (await language.boundingBox())!;
  await language.click();
  const search = card.getByRole("combobox", { name: "搜索代码语言" });
  const menu = page.getByRole("dialog", { name: "代码语言选项" });
  const list = menu.getByRole("listbox", { name: "代码语言选项" });
  const selected = list.getByRole("option", { name: "TypeScript", exact: true });
  await expect(list.locator(".semlo-editor-code-menu-label")).toHaveText(observedLanguages);
  const markedOptions = await list.locator(".semlo-editor-code-menu-option").evaluateAll((rows) =>
    rows
      .map((row) => ({
        label: row.querySelector(".semlo-editor-code-menu-label")?.textContent,
        note: row.querySelector(".semlo-editor-code-menu-note")?.textContent,
      }))
      .filter((row) => row.note),
  );
  expect(markedOptions.filter((option) => option.note === "纯文本").map((option) => option.label)).toEqual([]);
  expect(markedOptions.filter((option) => option.note === "近似高亮").map((option) => option.label)).toEqual([
    "ABAP",
    "Agda",
    "ArkTS",
    "Asm",
    "Basic",
    "Cypher",
    "Git",
    "GraphQL",
    "JSX",
    "KaTeX",
    "Makefile",
    "Markdown",
    "PL/SQL",
    "Sass",
    "Shell",
    "Solidity",
    "sTeX",
    "SystemVerilog",
    "TSX",
    "Velocity",
    "Vue",
  ]);
  await expect(search).toBeFocused();
  await expect(search).toHaveAttribute("placeholder", "TypeScript");
  await expect(search).toHaveValue("");
  expect(Math.abs((await search.boundingBox())!.x - languageBefore.x)).toBeLessThan(2);
  await expect(selected).toHaveAttribute("aria-selected", "true");
  const selectedGeometry = await selected.evaluate((row) => {
    const item = row.getBoundingClientRect();
    const parent = row.parentElement!.getBoundingClientRect();
    return { top: item.top, bottom: item.bottom, parentTop: parent.top, parentBottom: parent.bottom };
  });
  expect(selectedGeometry.top).toBeGreaterThanOrEqual(selectedGeometry.parentTop);
  expect(selectedGeometry.bottom).toBeLessThanOrEqual(selectedGeometry.parentBottom);
  expect((await menu.boundingBox())!.width).toBeCloseTo(140, 0);
  expect((await menu.boundingBox())!.height).toBeLessThanOrEqual(264);

  await search.fill("tsx");
  await expect(list.getByRole("option")).toHaveCount(1);
  await expect(list.getByRole("option", { name: "TSX（近似高亮）", exact: true })).toBeVisible();
  // An IME confirmation must not choose an option before composition finishes.
  await search.evaluate((input) =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true })),
  );
  await expect(menu).toBeVisible();
  await search.press("Enter");
  await expect(menu).toHaveCount(0);
  await expect(language).toHaveText("TSX");
  await expect(language).toHaveAttribute("data-value", "tsx");
  await expect(host.locator(".semlo-editor-prose")).toBeFocused();
  await expect(card).toHaveClass(/is-active/);
  expect(
    await page.evaluate(() => ({
      from: window.__semloRequireFixture("codeControlsEditor").editor.state.selection.from,
      to: window.__semloRequireFixture("codeControlsEditor").editor.state.selection.to,
    })),
  ).toEqual(before);
  await expect(code.locator(".hljs-keyword")).not.toHaveCount(0);
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("codeControlsEditor").getSnapshot());
  expect(snapshot.html).toContain("language-tsx");
  expect(snapshot.json.content?.find((node) => node.type === "codeBlock")?.attrs?.language).toBe("tsx");

  await language.click();
  const reopened = card.getByRole("combobox", { name: "搜索代码语言" });
  await reopened.press("ArrowDown");
  await reopened.press("Enter");
  await expect(language).toHaveText("TypeScript");

  await language.click();
  await card.getByRole("combobox", { name: "搜索代码语言" }).press("Escape");
  await expect(language).toBeFocused();
  await expect(page.getByRole("dialog", { name: "代码语言选项" })).toHaveCount(0);
  await language.click();
  await card.getByRole("combobox", { name: "搜索代码语言" }).press("Tab");
  await expect(card.getByRole("button", { name: "代码主题" })).toBeFocused();
});

test("theme options preserve old values and persist all six choices through HTML and JSON", async ({ page }) => {
  const host = await mount(page);
  const card = host.locator(".semlo-editor-code-card");
  const theme = card.getByRole("button", { name: "代码主题" });
  const choices = [
    ["Yuque Light Pro", "light-pro"],
    ["Yuque Light", "light"],
    ["Bracket Lights Pro", "bracket-lights-pro"],
    ["One Dark Pro", "dark"],
    ["Night Owl", "night-owl"],
    ["Darcula", "darcula"],
  ];
  for (const [label, value] of choices) {
    await theme.click();
    const menu = page.getByRole("dialog", { name: "代码主题选项" });
    const list = menu.getByRole("listbox", { name: "代码主题选项" });
    await expect(list.locator(".semlo-editor-code-menu-label")).toHaveText(choices.map(([name]) => name));
    expect((await menu.boundingBox())!.width).toBeCloseTo(168, 0);
    const chosen = list.getByRole("option", { name: label, exact: true });
    await chosen.click();
    await expect(theme).toHaveText(label);
    await expect(card).toHaveAttribute("data-theme", value);
    const snapshot = await page.evaluate(() => window.__semloRequireFixture("codeControlsEditor").getSnapshot());
    expect(snapshot.html).toContain(`data-theme="${value}"`);
    expect(snapshot.json.content?.find((node) => node.type === "codeBlock")?.attrs?.theme).toBe(value);
    await page.evaluate((html) => window.__semloRequireFixture("codeControlsEditor").setContent(html), snapshot.html);
    await expect(card).toHaveAttribute("data-theme", value);
    await expect(theme).toHaveText(label);
    await page.evaluate((json) => window.__semloRequireFixture("codeControlsEditor").setContent(json), snapshot.json);
    await expect(card).toHaveAttribute("data-theme", value);
    await expect(theme).toHaveText(label);
  }
  await theme.click();
  const current = page.getByRole("option", { name: "Darcula", exact: true });
  await expect(current).toHaveAttribute("aria-selected", "true");
  const positions = await current.evaluate((row) => ({
    check: row.querySelector(".semlo-editor-code-menu-check")!.getBoundingClientRect().left,
    text: row.querySelector(".semlo-editor-code-menu-label")!.getBoundingClientRect().left,
  }));
  expect(positions.check).toBeLessThan(positions.text);
  await page.getByRole("listbox", { name: "代码主题选项" }).press("ArrowDown");
  await page.getByRole("listbox", { name: "代码主题选项" }).press("Enter");
  await expect(theme).toHaveText("Yuque Light Pro");
  await expect(host.locator(".semlo-editor-prose")).toBeFocused();
  await theme.click();
  await page.getByRole("listbox", { name: "代码主题选项" }).press("End");
  await page.getByRole("listbox", { name: "代码主题选项" }).press("Space");
  await expect(theme).toHaveText("Darcula");
});

test("unknown languages fall back to plain text while approximate grammars remain selectable", async ({ page }) => {
  const host = await mount(page);
  const card = host.locator(".semlo-editor-code-card");
  await page.evaluate(() =>
    window
      .__semloRequireFixture("codeControlsEditor")
      .setContent('<pre data-theme="light"><code class="language-unknown-lang">const x = 1</code></pre>'),
  );
  const language = card.getByRole("button", { name: "代码语言" });
  await expect(language).toHaveText("unknown-lang");
  await expect(language).toHaveAttribute("title", "unknown-lang（纯文本）");
  await expect(card.locator('[class*="hljs-"]')).toHaveCount(0);
  await language.click();
  const search = card.getByRole("combobox", { name: "搜索代码语言" });
  await search.fill("ABAP");
  const approximate = page.getByRole("option", { name: "ABAP（近似高亮）", exact: true });
  await expect(approximate).toBeVisible();
  await search.press("Escape");
  expect((await page.evaluate(() => window.__semloRequireFixture("codeControlsEditor").getSnapshot())).html).toContain(
    "language-unknown-lang",
  );
  const approximateLanguages = [
    ["ABAP", "abap"],
    ["Agda", "agda"],
    ["Cypher", "cypher"],
    ["Git", "git"],
    ["Solidity", "solidity"],
    ["Velocity", "velocity"],
  ];
  for (const [label, value] of approximateLanguages) {
    await language.click();
    await card.getByRole("combobox", { name: "搜索代码语言" }).fill(label);
    await page.getByRole("option", { name: `${label}（近似高亮）`, exact: true }).click();
    await expect(language).toHaveText(label);
    await expect(language).toHaveAttribute("title", `${label}（近似高亮）`);
    const snapshot = await page.evaluate(() => window.__semloRequireFixture("codeControlsEditor").getSnapshot());
    expect(snapshot.html).toContain(`language-${value}`);
    expect(snapshot.json.content?.find((node) => node.type === "codeBlock")?.attrs?.language).toBe(value);
  }
  const approximateSnapshot = await page.evaluate(() =>
    window.__semloRequireFixture("codeControlsEditor").getSnapshot(),
  );
  await page.evaluate(
    (html) => window.__semloRequireFixture("codeControlsEditor").setContent(html),
    approximateSnapshot.html,
  );
  await expect(language).toHaveText("Velocity");
  await expect(language).toHaveAttribute("title", "Velocity（近似高亮）");
  await page.evaluate(
    (json) => window.__semloRequireFixture("codeControlsEditor").setContent(json),
    approximateSnapshot.json,
  );
  await expect(language).toHaveText("Velocity");
  await language.click();
  await card.getByRole("combobox", { name: "搜索代码语言" }).fill("ArkTS");
  await page.getByRole("option", { name: "ArkTS（近似高亮）", exact: true }).click();
  await expect(language).toHaveText("ArkTS");
  await expect(language).toHaveAttribute("title", "ArkTS（近似高亮）");
  await expect(card.locator(".hljs-keyword")).not.toHaveCount(0);
  await language.click();
  await card.getByRole("combobox", { name: "搜索代码语言" }).fill("Plain Text");
  await page.getByRole("option", { name: "Plain Text", exact: true }).click();
  await expect(language).toHaveText("Plain Text");
  await expect(card.locator('[class*="hljs-"]')).toHaveCount(0);
});

test("open menus close on read-only transition and editor destruction", async ({ page }) => {
  const host = await mount(page);
  const card = host.locator(".semlo-editor-code-card");
  const language = card.getByRole("button", { name: "代码语言" });
  await language.click();
  await expect(page.getByRole("dialog", { name: "代码语言选项" })).toBeVisible();
  await page.evaluate(() => window.__semloRequireFixture("codeControlsEditor").setEditable(false));
  await expect(page.getByRole("dialog", { name: "代码语言选项" })).toHaveCount(0);
  await expect(language).toBeDisabled();
  await expect(card.getByRole("button", { name: "代码主题" })).toBeDisabled();
  await page.evaluate(() => window.__semloRequireFixture("codeControlsEditor").setEditable(true));
  await expect(language).toBeEnabled();
  await language.click();
  await page.evaluate(() => window.__semloRequireFixture("codeControlsEditor").destroy());
  await expect(page.locator(".semlo-editor-code-menu")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "搜索代码语言" })).toHaveCount(0);
});

test("choosing a language or theme in a folded card keeps the control focused", async ({ page }) => {
  const host = await mount(page);
  const card = host.locator(".semlo-editor-code-card");
  const language = card.getByRole("button", { name: "代码语言" });
  const theme = card.getByRole("button", { name: "代码主题" });
  await card.getByRole("button", { name: "收起代码块" }).click();
  await language.click();
  const search = card.getByRole("combobox", { name: "搜索代码语言" });
  await search.fill("tsx");
  await search.press("Enter");
  await expect(language).toBeFocused();
  await expect(language).toHaveText("TSX");
  await expect(card).toHaveClass(/is-collapsed/);
  await theme.click();
  await page.getByRole("option", { name: "Night Owl", exact: true }).click();
  await expect(theme).toBeFocused();
  await expect(card).toHaveAttribute("data-theme", "night-owl");
  await expect(card).toHaveClass(/is-collapsed/);
});

test("copy presents an accessible icon and restores it after the feedback", async ({ page }) => {
  const host = await mount(page);
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => {} },
    }),
  );
  const copy = host.getByRole("button", { name: "复制代码" });
  await expect(copy.locator("svg")).toBeVisible();
  await copy.click();
  await expect(host.getByRole("button", { name: "已复制" }).locator("svg path")).toHaveAttribute("d", "M5 12l4 4L19 6");
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    }),
  );
  await host.getByRole("button", { name: "已复制" }).click();
  await expect(host.getByRole("button", { name: "复制失败" }).locator("svg path")).toHaveAttribute(
    "d",
    "M6 6l12 12M18 6 6 18",
  );
  await expect(host.getByRole("button", { name: "复制代码" }).locator("svg")).toBeVisible({ timeout: 4_000 });
});

test("menus fit a small viewport and remain isolated between editors", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 360 });
  const first = await mount(page);
  await first.evaluate((host) => ((host as HTMLElement).style.width = "460px"));
  const language = first.getByRole("button", { name: "代码语言" });
  await language.scrollIntoViewIfNeeded();
  await language.click();
  const popup = page.getByRole("dialog", { name: "代码语言选项" });
  const bounds = (await popup.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(7);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(473);
  expect(bounds.y).toBeGreaterThanOrEqual(7);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(353);

  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'second-code-controls-test'
      host.style.width = '460px'
      document.body.append(host)
      window.secondCodeControlsEditor = createEditor({
        element: host,
        outline: false,
        content: '<pre><code class="language-javascript">const second = 2</code></pre>',
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.secondCodeControlsEditor));
  const second = page.locator("#second-code-controls-test");
  await second.locator(".semlo-editor-code-card").hover();
  await second.getByRole("button", { name: "代码主题" }).click();
  const secondPopup = page.getByRole("dialog", { name: "代码主题选项" });
  await expect(popup).toHaveCount(0);
  await expect(secondPopup).toBeVisible();
  await page.evaluate(() => window.__semloRequireFixture("codeControlsEditor").destroy());
  await expect(secondPopup).toBeVisible();
  await page.evaluate(() => window.__semloRequireFixture("secondCodeControlsEditor").setContent("<p>替换代码块</p>"));
  await expect(secondPopup).toHaveCount(0);
  await page.evaluate(() => window.__semloRequireFixture("secondCodeControlsEditor").destroy());
});

for (const [control, choice] of [
  ["代码主题", "Night Owl"],
  ["代码语言", "Python"],
]) {
  test(`destroying the editor during ${control} selection closes the popup safely`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const host = await mount(page);
    await page.evaluate(() => {
      const editor = window.__semloRequireFixture("codeControlsEditor").editor;
      editor.on("update", () => editor.destroy());
    });
    await page.evaluate(() => {
      const tracked = new Set<EventListenerOrEventListenerObject>();
      Object.defineProperty(window, "__codePopupListeners", { value: tracked, configurable: true });
      const add = document.addEventListener.bind(document);
      const remove = document.removeEventListener.bind(document);
      document.addEventListener = ((
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) => {
        if (type === "pointerdown" && listener) tracked.add(listener);
        add(type, listener, options);
      }) as typeof document.addEventListener;
      document.removeEventListener = ((
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | EventListenerOptions,
      ) => {
        if (type === "pointerdown" && listener) tracked.delete(listener);
        remove(type, listener, options);
      }) as typeof document.removeEventListener;
    });
    await host.getByRole("button", { name: control }).click();
    expect(await page.evaluate(() => Reflect.get(window, "__codePopupListeners").size)).toBeGreaterThan(0);
    await page.getByRole("option", { name: choice, exact: true }).click();
    expect(await page.evaluate(() => Reflect.get(window, "__codePopupListeners").size)).toBe(0);
    expect(await page.evaluate(() => window.__semloRequireFixture("codeControlsEditor").editor.isDestroyed)).toBe(true);
    await expect(page.getByRole("dialog", { name: `${control}选项` })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

for (const [control, choice] of [
  ["代码主题", "Night Owl"],
  ["代码语言", "Python"],
]) {
  test(`replacing the document during ${control} selection keeps the replacement`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const host = await mount(page);
    await page.evaluate(() => {
      const editor = window.__semloRequireFixture("codeControlsEditor").editor;
      let replaced = false;
      editor.on("update", () => {
        if (replaced) return;
        replaced = true;
        editor.commands.setContent("<p>replacement</p>");
      });
    });
    await host.getByRole("button", { name: control }).click();
    await page.getByRole("option", { name: choice, exact: true }).click();
    await expect(host.locator(".semlo-editor-prose")).toHaveText("replacement");
    await expect(page.getByRole("dialog", { name: `${control}选项` })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
