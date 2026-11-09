async function _browserTest(page: import("playwright").Page) {
  if (page.url() !== "about:blank") await page.goto(new URL("/", page.url()).href);
  await page.evaluate(async () => {
    const { createEditor } = await import("/dist/index.js");
    document.body.replaceChildren();
    document.body.style.margin = "0";
    const host = document.createElement("div");
    host.id = "block-heading-test";
    host.style.width = "560px";
    document.body.append(host);
    window.coexistChanges = 0;
    window.coexistApi = createEditor({
      element: host,
      onChange: () => window.__semloIncrementFixture("coexistChanges"),
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "普通标题一段足够长的文字用来检查是否被控件遮挡" }],
          },
          { type: "paragraph", content: [{ type: "text", text: "普通标题正文" }] },
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "子标题" }] },
          { type: "paragraph", content: [{ type: "text", text: "子标题正文" }] },
          {
            type: "blockquote",
            content: [
              { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "容器内标题" }] },
              { type: "paragraph", content: [{ type: "text", text: "容器内正文" }] },
            ],
          },
          { type: "paragraph", content: [{ type: "text", text: "末尾" }] },
        ],
      },
    });
    host.querySelector<HTMLElement>(".semlo-editor-toolbar")!.style.display = "none";
  });
  const host = page.locator("#block-heading-test"),
    prose = host.locator(".semlo-editor-prose");
  const heading = (name: string) => prose.locator("h1,h2,h3,h4,h5,h6").filter({ hasText: name });
  const toggle = (name: string) => heading(name).locator(".semlo-editor-heading-fold-toggle");
  const handle = page.locator(".semlo-editor-block-handle:visible"),
    menu = page.getByRole("menu", { name: "块操作" });
  const hoverHeading = async (name: string) => {
    await toggle(name).scrollIntoViewIfNeeded();
    const box = await heading(name).boundingBox();
    await heading(name).hover({ position: { x: Math.max(1, box!.width - 4), y: Math.min(8, box!.height - 1) } });
  };
  const check = async (name: string, body: string) => {
    await hoverHeading(name);
    await handle.waitFor({ state: "visible" });
    await page.waitForTimeout(80);
    const geometry = await page.evaluate((name) => {
      const title = [
        ...document.querySelectorAll("#block-heading-test .semlo-editor-prose :is(h1,h2,h3,h4,h5,h6)"),
      ].find((el) => el.textContent?.includes(name));
      const fold = title!.querySelector(".semlo-editor-heading-fold-toggle"),
        handle = document.querySelector(".semlo-editor-block-handle:not([hidden])");
      const f = fold!.getBoundingClientRect(),
        h = handle!.getBoundingClientRect();
      const walker = document.createTreeWalker(title!, NodeFilter.SHOW_TEXT),
        text = walker.nextNode();
      const range = document.createRange();
      range.selectNodeContents(text!);
      const letters = [...range.getClientRects()];
      const intersects = (a: DOMRect, b: DOMRect) =>
        a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const hit = (rect: DOMRect) => document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        fold: { x: f.x, y: f.y, right: f.right, bottom: f.bottom },
        handle: { x: h.x, y: h.y, right: h.right, bottom: h.bottom },
        overlap: intersects(f, h),
        coversText: letters.some((r) => intersects(r, f) || intersects(r, h)),
        foldHit: fold!.contains(hit(f)),
        handleHit: handle!.contains(hit(h)),
        viewport: [innerWidth, innerHeight],
      };
    }, name);
    if (
      geometry.overlap ||
      geometry.coversText ||
      !geometry.foldHit ||
      !geometry.handleHit ||
      geometry.fold.x < 0 ||
      geometry.handle.x < 0 ||
      geometry.fold.right > geometry.viewport[0] ||
      geometry.handle.right > geometry.viewport[0]
    )
      throw new Error(`${name}: controls not independently clickable: ${JSON.stringify(geometry)}`);
    await toggle(name).click({ timeout: 1500 });
    if (await prose.getByText(body, { exact: true }).isVisible())
      throw new Error(`${name}: fold click did not hide content`);
    await toggle(name).click({ timeout: 1500 });
    if (!(await prose.getByText(body, { exact: true }).isVisible()))
      throw new Error(`${name}: fold click did not restore content`);
    await hoverHeading(name);
    await handle.waitFor({ state: "visible" });
    await handle.click({ timeout: 1500 });
    await menu.waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
  };
  await check("普通标题", "普通标题正文");
  await check("子标题", "子标题正文");
  await check("容器内标题", "容器内正文");
  await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>("#block-heading-test")!;
    host.style.width = "180px";
    host.style.height = "200px";
    host.style.overflow = "auto";
    host.querySelector<HTMLElement>(".semlo-editor-content")!.style.padding = "0 4px 32px";
  });
  await check("普通标题", "普通标题正文");
  await check("容器内标题", "容器内正文");
  await hoverHeading("子标题");
  await handle.waitFor({ state: "visible" });
  const beforeScroll = await handle.boundingBox();
  const scrollDelta = await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>("#block-heading-test")!,
      before = host.scrollTop;
    host.scrollTop += 12;
    return host.scrollTop - before;
  });
  if (scrollDelta <= 0) throw new Error("Scroll fixture did not move");
  await page.waitForFunction(
    ({ top, delta }) => {
      const el = document.querySelector(".semlo-editor-block-handle:not([hidden])");
      return el && Math.abs(el.getBoundingClientRect().top - (top - delta)) < 1;
    },
    { top: beforeScroll!.y, delta: scrollDelta },
  );
  await check("子标题", "子标题正文");
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("#block-heading-test")!.style.width = "70px";
  });
  await check("子标题", "子标题正文");
  await page.evaluate(() => window.__semloRequireFixture("coexistApi").setEditable(false));
  const readonlySnapshot = await page.evaluate(() => window.__semloRequireFixture("coexistApi").getSnapshot());
  const readonlyChanges = await page.evaluate(() => window.__semloRequireFixture("coexistChanges"));
  await hoverHeading("普通标题");
  await page.waitForTimeout(80);
  if (await handle.count()) throw new Error("Read-only mode exposed the block handle");
  await toggle("普通标题").click({ timeout: 1500 });
  if (await prose.getByText("普通标题正文", { exact: true }).isVisible())
    throw new Error("Read-only heading toggle did not work");
  if (
    (await page.evaluate(() => window.__semloRequireFixture("coexistChanges"))) !== readonlyChanges ||
    JSON.stringify(await page.evaluate(() => window.__semloRequireFixture("coexistApi").getSnapshot())) !==
      JSON.stringify(readonlySnapshot)
  )
    throw new Error("Read-only folding changed document data");
  await page.evaluate(() => window.__semloRequireFixture("coexistApi").destroy());
  if (await page.locator(".semlo-editor-block-handle").count()) throw new Error("Destroy left a block handle behind");
  return {
    defaultMargin: true,
    nested: true,
    smallMargin: true,
    scroll: true,
    stacked: true,
    readonly: true,
    destroy: true,
  };
}
