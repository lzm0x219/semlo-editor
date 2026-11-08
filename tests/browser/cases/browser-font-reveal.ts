async function _browserTest(
  page: import("playwright").Page,
  fonts: import("../../fixtures/browser/font-toolbar").FontToolbarTools,
) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  await page.evaluate(async () => {
    const spacer = document.createElement("div");
    spacer.style.height = "800px";
    const host = document.createElement("div");
    host.id = "font-reveal-test";
    const footer = document.createElement("div");
    footer.style.height = "1800px";
    document.body.replaceChildren(spacer, host, footer);
    window.revealFonts = Array.from(
      { length: 1100 },
      (_, index): { family: string; fullName: string; postscriptName?: string; style?: string } => {
        const id = String(index).padStart(4, "0");
        return { family: `Family ${id}`, fullName: `字体 ${id}`, postscriptName: `Face-${id}` };
      },
    ).concat([
      { family: "Shared Family", fullName: "字体 ZZA Regular", style: "Regular" },
      { family: "Shared Family", fullName: "字体 ZZB Bold", style: "Bold" },
      { family: 'Quote "Font" \\ Demo', fullName: "字体 ZZZ Special", style: "Regular" },
      { family: "Long Name Font", fullName: "字体 ZZZZZ " + "延".repeat(90), style: "Regular" },
    ]);
    window.revealRequests = [];
    Object.defineProperty(window, "queryLocalFonts", {
      configurable: true,
      writable: true,
      value: () =>
        new Promise((resolve, reject) => window.__semloRequireFixture("revealRequests").push({ resolve, reject })),
    });
    const { createEditor } = await import("/dist/index.js");
    window.revealApi = createEditor({
      element: host,
      content: {
        type: "doc",
        attrs: { semloEditorDocumentFontFamily: "Face-0950", semloEditorDocumentFontName: "字体 0950" },
        content: [{ type: "paragraph", content: [{ type: "text", text: "甲乙丙丁" }] }],
      },
    });
    window.scrollTo(0, 780);
  });
  const host = page.locator("#font-reveal-test");
  const menu = page.getByRole("dialog", { name: "选择字体" });
  const search = menu.getByLabel("搜索字体");
  const selected = () => menu.locator('button[role="option"][aria-selected="true"]');
  const open = async () => {
    await fonts.open(host);
    await menu.waitFor();
  };
  const close = async () => {
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });
  };
  const waitForVisibleSelection = async (name: string, previousScrollY?: number) => {
    await page.waitForFunction((expected) => {
      const list = document.querySelector(".semlo-editor-local-font-list");
      const rows = list?.querySelectorAll('button[role="option"][aria-selected="true"]');
      if (!list || rows?.length !== 1 || rows[0].getAttribute("aria-label") !== expected) return false;
      const row = rows[0].getBoundingClientRect(),
        bounds = list.getBoundingClientRect();
      return (
        list.scrollTop > 0 &&
        row.top >= bounds.top + list.clientTop - 1 &&
        row.bottom <= bounds.top + list.clientTop + list.clientHeight + 1
      );
    }, name);
    // Wait until content-visibility has had another paint to settle.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const geometry = await menu.locator(".semlo-editor-local-font-list").evaluate((list) => {
      const row = list.querySelector('button[aria-selected="true"]'),
        bounds = list.getBoundingClientRect(),
        rect = row!.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        listTop: bounds.top + list.clientTop,
        listBottom: bounds.top + list.clientTop + list.clientHeight,
        scrollTop: list.scrollTop,
        scrollY: window.scrollY,
      };
    });
    if (geometry.top < geometry.listTop - 1 || geometry.bottom > geometry.listBottom + 1 || geometry.scrollTop <= 0)
      throw new Error(`Selected font ${name} was outside the list: ${JSON.stringify(geometry)}`);
    if (previousScrollY != null && Math.abs(geometry.scrollY - previousScrollY) > 1)
      throw new Error(`Opening the font menu scrolled the page: ${JSON.stringify(geometry)}`);
  };
  const assertVisibleNow = async (name: string, previousScrollY: number) => {
    const geometry = await menu.locator(".semlo-editor-local-font-list").evaluate((list) => {
      const row = list.querySelector('button[aria-selected="true"]'),
        bounds = list.getBoundingClientRect(),
        rect = row!.getBoundingClientRect();
      return {
        name: row!.getAttribute("aria-label"),
        top: rect.top,
        bottom: rect.bottom,
        listTop: bounds.top + list.clientTop,
        listBottom: bounds.top + list.clientTop + list.clientHeight,
        scrollTop: list.scrollTop,
        scrollY: window.scrollY,
      };
    });
    if (
      geometry.name !== name ||
      geometry.top < geometry.listTop - 1 ||
      geometry.bottom > geometry.listBottom + 1 ||
      geometry.scrollTop <= 0 ||
      Math.abs(geometry.scrollY - previousScrollY) > 1
    )
      throw new Error("The font shifted after appearing: " + JSON.stringify(geometry));
  };
  const setContentAndSelection = async (
    content: import("../../../packages/core/src/types").EditorContent,
    selection: number | { from: number; to: number },
  ) =>
    page.evaluate(
      ({ content, selection }) => {
        window.__semloRequireFixture("revealApi").setContent(content);
        window.__semloRequireFixture("revealApi").editor.commands.focus();
        window.__semloRequireFixture("revealApi").editor.commands.setTextSelection(selection);
      },
      { content, selection },
    );
  const documentContent = (
    family: string | null,
    name: string | null,
    children: import("@tiptap/core").JSONContent[] = [{ type: "text", text: "甲乙丙丁" }],
  ) => ({
    type: "doc",
    attrs: { semloEditorDocumentFontFamily: family, semloEditorDocumentFontName: name },
    content: [{ type: "paragraph", content: children }],
  });
  const textWithFont = (text: string, family: string | null, name: string | null) => ({
    type: "text",
    text,
    marks: [{ type: "textStyle", attrs: { fontFamily: family, semloEditorFontName: name } }],
  });

  const beforeAsync = await page.evaluate(() => window.scrollY);
  await open();
  if ((await page.evaluate(() => window.__semloRequireFixture("revealRequests").length)) !== 1)
    throw new Error("The initial list did not load asynchronously");
  await page.evaluate(() =>
    window.__semloRequireFixture("revealRequests")[0].resolve(window.__semloRequireFixture("revealFonts")),
  );
  await waitForVisibleSelection("字体 0950", beforeAsync);
  await close();
  const beforeCached = await page.evaluate(() => window.scrollY);
  await open();
  await waitForVisibleSelection("字体 0950", beforeCached);
  if ((await page.evaluate(() => window.__semloRequireFixture("revealRequests").length)) !== 1)
    throw new Error("Reopening did not reuse the font cache");

  // Simulate late font metrics changing after the first visible frame.
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.id = "late-font-metrics-test";
    document.head.append(style);
    setTimeout(() => {
      style.textContent = ".semlo-editor-local-font-preview { line-height: 60px !important; }";
    }, 150);
  });
  await page.waitForTimeout(700);
  await assertVisibleNow("字体 0950", beforeCached);
  const first = await menu.locator(".semlo-editor-local-font-list").evaluate(async (list) => {
    list.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -100 }));
    list.scrollTop = 0;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const row = list.firstElementChild,
      a = row!.getBoundingClientRect(),
      b = list.getBoundingClientRect();
    return {
      rowTop: a.top,
      rowBottom: a.bottom,
      listTop: b.top + list.clientTop,
      listBottom: b.top + list.clientTop + list.clientHeight,
    };
  });
  if (first.rowTop < first.listTop - 1 || first.rowBottom > first.listBottom + 1)
    throw new Error("The first font row is clipped: " + JSON.stringify(first));
  const last = await menu.locator(".semlo-editor-local-font-list").evaluate(async (list) => {
    list.scrollTop = list.scrollHeight;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const row = list.lastElementChild,
      previous = row!.previousElementSibling,
      label = row!.querySelector(".semlo-editor-local-font-option-label"),
      preview = row!.querySelector(".semlo-editor-local-font-preview");
    const a = row!.getBoundingClientRect(),
      b = list.getBoundingClientRect(),
      prior = previous!.getBoundingClientRect();
    return {
      rowTop: a.top,
      rowBottom: a.bottom,
      rowHeight: a.height,
      previousBottom: prior.bottom,
      listTop: b.top + list.clientTop,
      listBottom: b.top + list.clientTop + list.clientHeight,
      rowOverflow: getComputedStyle(row!).overflowY,
      labelOverflow: getComputedStyle(label!).overflow,
      labelEllipsis: getComputedStyle(label!).textOverflow,
      labelWidth: label!.clientWidth,
      labelScrollWidth: label!.scrollWidth,
      previewLineHeight: getComputedStyle(preview!).lineHeight,
    };
  });
  if (
    last.rowTop < last.listTop - 1 ||
    last.rowBottom > last.listBottom + 1 ||
    last.rowHeight !== 34 ||
    last.previousBottom > last.rowTop + 1 ||
    last.rowOverflow !== "hidden" ||
    last.previewLineHeight !== "60px" ||
    last.labelOverflow !== "hidden" ||
    last.labelEllipsis !== "ellipsis" ||
    last.labelScrollWidth <= last.labelWidth
  )
    throw new Error("Font rows did not contain previews or truncate a long name: " + JSON.stringify(last));
  if (Math.abs((await page.evaluate(() => window.scrollY)) - beforeCached) > 1)
    throw new Error("Browsing the list scrolled the page");
  await page.evaluate(() => document.querySelector("#late-font-metrics-test")!.remove());
  await close();
  for (let iteration = 0; iteration < 4; iteration++) {
    const beforeRepeat = await page.evaluate(() => window.scrollY);
    await open();
    await waitForVisibleSelection("字体 0950", beforeRepeat);
    await page.waitForTimeout(iteration === 3 ? 1000 : 250);
    await assertVisibleNow("字体 0950", beforeRepeat);
    await close();
  }
  await open();
  await waitForVisibleSelection("字体 0950");

  await search.fill("字体 1025");
  await menu.getByRole("option", { name: "字体 1025", exact: true }).click();
  const documentFont = await page.evaluate(() => window.__semloRequireFixture("revealApi").getSnapshot().json.attrs!);
  if (
    documentFont.semloEditorDocumentFontFamily !== "Face-1025" ||
    documentFont.semloEditorDocumentFontName !== "字体 1025"
  )
    throw new Error("No selection did not apply the document font");
  const beforeApplied = await page.evaluate(() => window.scrollY);
  await open();
  await waitForVisibleSelection("字体 1025", beforeApplied);
  await close();

  await page.evaluate(() => {
    window.__semloRequireFixture("revealApi").editor.commands.focus();
    window.__semloRequireFixture("revealApi").editor.commands.setTextSelection({ from: 1, to: 3 });
  });
  await open();
  await waitForVisibleSelection("字体 1025"); // Selected text inherits the document font.
  await search.fill("字体 0980");
  await menu.getByRole("option", { name: "字体 0980", exact: true }).click();
  const local = await page.evaluate(() => window.__semloRequireFixture("revealApi").getSnapshot().json);
  const localStyle = local.content![0].content![0].marks!.find((mark) => mark.type === "textStyle")!.attrs!;
  if (
    local.attrs!.semloEditorDocumentFontFamily !== "Face-1025" ||
    localStyle.fontFamily !== '"Face-0980"' ||
    localStyle.semloEditorFontName !== "字体 0980"
  )
    throw new Error("A text selection did not retain its own font");
  await open();
  await waitForVisibleSelection("字体 0980");
  await close();
  await page.evaluate(() => {
    window.__semloRequireFixture("revealApi").editor.commands.setTextSelection({ from: 3, to: 5 });
  });
  await open();
  await waitForVisibleSelection("字体 1025");
  await close();
  await page.evaluate(() => {
    window.__semloRequireFixture("revealApi").editor.commands.setTextSelection({ from: 1, to: 5 });
  });
  await open();
  if (await selected().count()) throw new Error("A mixed selection incorrectly reported one font");
  await close();

  await setContentAndSelection(documentContent("Shared Family", "字体 ZZB Bold"), 1);
  await open();
  await waitForVisibleSelection("字体 ZZB Bold");
  if (
    (await menu.getByRole("option", { name: "字体 ZZA Regular", exact: true }).getAttribute("aria-selected")) !==
    "false"
  )
    throw new Error("Duplicate CSS family selected the wrong document font");
  await close();
  await page.evaluate(() =>
    window.__semloRequireFixture("revealApi").editor.commands.setTextSelection({ from: 1, to: 3 }),
  );
  await open();
  await waitForVisibleSelection("字体 ZZB Bold");
  await close();

  await setContentAndSelection(
    documentContent(null, null, [
      textWithFont("甲乙", '"Shared Family"', "字体 ZZB Bold"),
      textWithFont("丙丁", "'Shared Family'", "字体 ZZA Regular"),
    ]),
    { from: 1, to: 3 },
  );
  await open();
  await waitForVisibleSelection("字体 ZZB Bold");
  await close();
  await page.evaluate(() =>
    window.__semloRequireFixture("revealApi").editor.commands.setTextSelection({ from: 1, to: 5 }),
  );
  await open();
  if (await selected().count()) throw new Error("A selection of different saved face names was not treated as mixed");
  await close();
  await setContentAndSelection(documentContent(null, null, [textWithFont("甲乙", "Shared Family", null)]), {
    from: 1,
    to: 3,
  });
  await open();
  if (await selected().count()) throw new Error("An ambiguous family without a saved name selected an arbitrary face");
  await close();

  await setContentAndSelection(documentContent(null, null, [textWithFont("甲乙", '"\\46 ace-0950"', "字体 0950")]), {
    from: 1,
    to: 3,
  });
  await open();
  await waitForVisibleSelection("字体 0950");
  await close();
  await setContentAndSelection(
    documentContent(null, null, [textWithFont("甲乙", '"Quote \\"Font\\" \\\\ Demo"', "字体 ZZZ Special")]),
    { from: 1, to: 3 },
  );
  await open();
  await waitForVisibleSelection("字体 ZZZ Special");
  await close();
  await setContentAndSelection(documentContent("Missing Family", "已移除的字体"), 1);
  await open();
  if (await selected().count()) throw new Error("A missing font incorrectly selected another row");
  await close();

  // Trigger user actions in the opening task, before the first positioning frame.
  await setContentAndSelection(documentContent("Face-0950", "字体 0950"), 1);
  await page.evaluate(() => {
    const more = document.querySelector<HTMLElement>("#font-reveal-test .semlo-editor-toolbar-more")!;
    if (more.getAttribute("aria-expanded") !== "true")
      more.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    document
      .getElementById(more.getAttribute("aria-controls")!)!
      .querySelector<HTMLElement>(".semlo-editor-font-family")!
      .click();
    const input = document.querySelector<HTMLInputElement>(".semlo-editor-local-font-search-row input")!;
    input.value = "字体 0";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(100);
  let interaction: { scrollTop: number; selected?: string | null; focused?: string | null } = await menu
    .locator(".semlo-editor-local-font-list")
    .evaluate((list) => ({
      scrollTop: list.scrollTop,
      selected: list.querySelector('[aria-selected="true"]')?.getAttribute("aria-label"),
    }));
  if (interaction.scrollTop > 1 || interaction.selected !== "字体 0950")
    throw new Error("Search was overridden by the opening reveal: " + JSON.stringify(interaction));
  await close();
  await page.evaluate(() => {
    const more = document.querySelector<HTMLElement>("#font-reveal-test .semlo-editor-toolbar-more")!;
    if (more.getAttribute("aria-expanded") !== "true")
      more.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    document
      .getElementById(more.getAttribute("aria-controls")!)!
      .querySelector<HTMLElement>(".semlo-editor-font-family")!
      .click();
    const input = document.querySelector<HTMLInputElement>(".semlo-editor-local-font-search-row input")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(100);
  interaction = await menu
    .locator(".semlo-editor-local-font-list")
    .evaluate((list) => ({ scrollTop: list.scrollTop, focused: document.activeElement?.getAttribute("aria-label") }));
  if (interaction.scrollTop > 1 || interaction.focused !== "默认字体")
    throw new Error("Keyboard navigation was overridden by the opening reveal: " + JSON.stringify(interaction));
  await close();
  await page.evaluate(() => {
    const more = document.querySelector<HTMLElement>("#font-reveal-test .semlo-editor-toolbar-more")!;
    if (more.getAttribute("aria-expanded") !== "true")
      more.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    document
      .getElementById(more.getAttribute("aria-controls")!)!
      .querySelector<HTMLElement>(".semlo-editor-font-family")!
      .click();
    const list = document.querySelector<HTMLElement>(".semlo-editor-local-font-list")!;
    list.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 100 }));
    list.scrollTop = 100;
  });
  await page.waitForTimeout(100);
  interaction = await menu.locator(".semlo-editor-local-font-list").evaluate((list) => ({ scrollTop: list.scrollTop }));
  if (interaction.scrollTop < 20 || interaction.scrollTop > 500)
    throw new Error("Manual scrolling was overridden by the opening reveal: " + JSON.stringify(interaction));
  await close();
  await page.evaluate(() => {
    const more = document.querySelector<HTMLElement>("#font-reveal-test .semlo-editor-toolbar-more")!;
    if (more.getAttribute("aria-expanded") !== "true")
      more.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    document
      .getElementById(more.getAttribute("aria-controls")!)!
      .querySelector<HTMLElement>(".semlo-editor-font-family")!
      .click();
    document.querySelector<HTMLElement>(".semlo-editor-local-font-read")!.click();
    const list = document.querySelector<HTMLElement>(".semlo-editor-local-font-list")!;
    list.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 100 }));
    list.scrollTop = 100;
  });
  if ((await page.evaluate(() => window.__semloRequireFixture("revealRequests").length)) !== 2)
    throw new Error("Refresh did not initiate a new request");
  await page.evaluate(() =>
    window.__semloRequireFixture("revealRequests")[1].resolve(window.__semloRequireFixture("revealFonts")),
  );
  await page.waitForTimeout(100);
  interaction = await menu.locator(".semlo-editor-local-font-list").evaluate((list) => ({ scrollTop: list.scrollTop }));
  if (interaction.scrollTop < 20 || interaction.scrollTop > 500)
    throw new Error("Refreshing the fonts overrode the user scroll position: " + JSON.stringify(interaction));
  await close();

  await page.evaluate(() =>
    Object.defineProperty(window, "queryLocalFonts", {
      configurable: true,
      writable: true,
      value: () => Promise.reject(new DOMException("denied", "NotAllowedError")),
    }),
  );
  await open();
  await menu.getByText("字体访问被拒绝，请检查浏览器权限").waitFor();
  await close();
  await page.evaluate(() =>
    Object.defineProperty(window, "queryLocalFonts", {
      configurable: true,
      writable: true,
      value: () =>
        new Promise((resolve) => {
          window.revealLate = resolve;
        }),
    }),
  );
  await open();
  await page.evaluate(() => {
    window.__semloRequireFixture("revealApi").setEditable(false);
    window.__semloRequireFixture("revealLate")(window.__semloRequireFixture("revealFonts"));
  });
  if (await menu.count()) throw new Error("Changing to read-only left the picker open");
  await page.evaluate(() => window.__semloRequireFixture("revealApi").setEditable(true));
  await open();
  await page.evaluate(() => {
    window.__semloRequireFixture("revealApi").destroy();
    window.__semloRequireFixture("revealLate")(window.__semloRequireFixture("revealFonts"));
  });
  await page.waitForTimeout(50);
  if (await menu.count()) throw new Error("Destroying the editor left the picker open");
  if (errors.length) throw new Error(errors.join("; "));
  return {
    asyncAndCachedReveal: true,
    documentAndSelection: true,
    inheritedAndMixed: true,
    duplicateFamilies: true,
    cssNormalization: true,
    interactionPreserved: true,
    noPageScroll: true,
    lifecycle: true,
  };
}
