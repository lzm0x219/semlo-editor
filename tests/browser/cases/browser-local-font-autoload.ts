async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  await page.evaluate(async () => {
    window.reads = [];
    Object.defineProperty(window, "queryLocalFonts", {
      configurable: true,
      writable: true,
      value: () =>
        new Promise((resolve, reject) =>
          window.__semloRequireFixture("reads").push({ resolve, reject, activated: navigator.userActivation.isActive }),
        ),
    });
    const { createEditor } = await import("/dist/index.js");
    for (const id of ["first-font-editor", "second-font-editor"]) {
      const host = document.createElement("div");
      host.id = id;
      document.body.prepend(host);
      createEditor({ element: host, content: "<p>字体测试</p>" });
    }
  });
  const first = page.locator("#first-font-editor"),
    second = page.locator("#second-font-editor");
  const firstButton = first.getByRole("button", { name: "字体", exact: true });
  const secondButton = second.getByRole("button", { name: "字体", exact: true });
  const menu = page.getByRole("dialog", { name: "选择字体" });
  await firstButton.click();
  if (
    (await page.evaluate(() => window.__semloRequireFixture("reads").length)) !== 1 ||
    !(await page.evaluate(() => window.__semloRequireFixture("reads")[0].activated))
  )
    throw new Error("First query did not happen during the toolbar click");
  await page.keyboard.press("Escape");
  await secondButton.click();
  if ((await page.evaluate(() => window.__semloRequireFixture("reads").length)) !== 1)
    throw new Error("Reopening while pending started a duplicate read");
  await page.evaluate(() => window.__semloRequireFixture("reads")[0].resolve([{ family: "字体一" }]));
  await menu.getByRole("option", { name: "字体一", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await firstButton.click();
  if (
    (await page.evaluate(() => window.__semloRequireFixture("reads").length)) !== 1 ||
    !(await menu.getByRole("option", { name: "字体一", exact: true }).count())
  )
    throw new Error("Successful read was not shared between editor instances");
  const refresh = menu.getByRole("button", { name: "刷新本机字体" });
  if (
    (await menu.locator("input").count()) !== 1 ||
    (await refresh.getAttribute("title")) !== "刷新本机字体" ||
    !(await refresh.locator("svg").count()) ||
    (await refresh.innerText())
  )
    throw new Error("The search row or icon-only refresh control is incorrect");
  await menu.getByLabel("搜索字体").focus();
  await page.keyboard.press("Tab");
  if (!(await refresh.evaluate((el) => el === document.activeElement && getComputedStyle(el).outlineStyle !== "none")))
    throw new Error("The refresh icon is not keyboard focusable or its focus is not visible");
  await refresh.click();
  if ((await page.evaluate(() => window.__semloRequireFixture("reads").length)) !== 2)
    throw new Error("Explicit refresh did not start a new query");
  await page.keyboard.press("Escape");
  await secondButton.click();
  await menu.getByRole("button", { name: "刷新本机字体" }).click();
  if ((await page.evaluate(() => window.__semloRequireFixture("reads").length)) !== 3)
    throw new Error("A new refresh could not replace an older pending request");
  await page.evaluate(() => window.__semloRequireFixture("reads")[2].resolve([{ family: "新字体" }]));
  await menu.getByRole("option", { name: "新字体", exact: true }).waitFor();
  await page.evaluate(() => window.__semloRequireFixture("reads")[1].resolve([{ family: "过期字体" }]));
  await page.waitForTimeout(20);
  if (await menu.getByRole("option", { name: "过期字体", exact: true }).count())
    throw new Error("An older result replaced the refreshed list");
  await page.keyboard.press("Escape");
  await firstButton.click();
  if (!(await menu.getByRole("option", { name: "新字体", exact: true }).count()))
    throw new Error("An older result replaced the shared cache");
  await menu.getByRole("button", { name: "刷新本机字体" }).click();
  await page.evaluate(() =>
    window.__semloRequireFixture("reads")[3].reject(new DOMException("denied", "NotAllowedError")),
  );
  await menu.getByText("字体访问被拒绝，请检查浏览器权限").waitFor();
  if (await menu.getByRole("option", { name: "新字体", exact: true }).count())
    throw new Error("A revoked permission left cached fonts visible");
  await menu.getByRole("button", { name: "刷新本机字体" }).click();
  await page.evaluate(() => window.__semloRequireFixture("reads")[4].resolve([{ family: "重试字体" }]));
  await menu.getByRole("option", { name: "重试字体", exact: true }).waitFor();
  await menu.getByRole("button", { name: "刷新本机字体" }).click();
  await page.evaluate(() =>
    window.__semloRequireFixture("reads")[5].reject(new DOMException("denied", "NotAllowedError")),
  );
  await menu.getByText("字体访问被拒绝，请检查浏览器权限").waitFor();
  await page.keyboard.press("Escape");
  await firstButton.click();
  if ((await page.evaluate(() => window.__semloRequireFixture("reads").length)) !== 7)
    throw new Error("Opening after a failure did not retry");
  await page.evaluate(() => window.__semloRequireFixture("reads")[6].resolve([{ family: "恢复字体" }]));
  await menu.getByRole("option", { name: "恢复字体", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.evaluate(() =>
    Object.defineProperty(window, "queryLocalFonts", {
      configurable: true,
      writable: true,
      value: () =>
        Promise.resolve(
          Array.from({ length: 425 }, (_, index) => {
            const id = String(index).padStart(3, "0");
            return { family: "Shared Family", fullName: `展示字体 ${id}`, postscriptName: `Face-${id}` };
          }),
        ),
    }),
  );
  // 暂存首次定位帧，模拟字体列表已经显示但自动定位尚未执行的时序。
  await page.evaluate(() => {
    const request = window.requestAnimationFrame;
    const cancel = window.cancelAnimationFrame;
    const pending = new Map<number, FrameRequestCallback>();
    let nextId = -1;
    window.requestAnimationFrame = (callback) => {
      const id = nextId--;
      pending.set(id, callback);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      if (pending.has(id)) pending.delete(id);
      else cancel.call(window, id);
    };
    Reflect.set(window, "runFirstFontRevealFrame", () => {
      const first = pending.entries().next().value;
      if (!first) return false;
      pending.delete(first[0]);
      first[1](performance.now());
      return true;
    });
    Reflect.set(window, "releaseFontRevealFrames", () => {
      window.requestAnimationFrame = request;
      window.cancelAnimationFrame = cancel;
      const callbacks = Array.from(pending.values());
      pending.clear();
      for (const callback of callbacks) callback(performance.now());
      return callbacks.length;
    });
  });
  await firstButton.click();
  const lastFont = menu.getByRole("option", { name: "展示字体 424", exact: true });
  await lastFont.waitFor({ state: "attached" });
  if ((await menu.getByRole("option").count()) !== 426) throw new Error("The full font list was truncated");
  const startedReveal = await page.evaluate(() => {
    const run = Reflect.get(window, "runFirstFontRevealFrame") as () => boolean;
    return run();
  });
  await lastFont.scrollIntoViewIfNeeded();
  const readScroll = () =>
    menu.locator(".semlo-editor-local-font-list").evaluate((list) => {
      const row = Array.from(list.querySelectorAll("button[role=option]")).at(-1),
        a = row!.getBoundingClientRect(),
        b = list.getBoundingClientRect();
      return {
        scrollable: list.scrollHeight > list.clientHeight,
        scrollTop: list.scrollTop,
        lastVisible: a.top >= b.top - 1 && a.bottom <= b.bottom + 1,
      };
    });
  const beforeReveal = await readScroll();
  const releasedFrames = await page.evaluate(() => {
    const release = Reflect.get(window, "releaseFontRevealFrames") as () => number;
    return release();
  });
  if (
    !startedReveal ||
    releasedFrames === 0 ||
    !beforeReveal.scrollable ||
    beforeReveal.scrollTop <= 0 ||
    !beforeReveal.lastVisible
  )
    throw new Error(
      "The font scroll race was not established: " + JSON.stringify({ beforeReveal, startedReveal, releasedFrames }),
    );
  const scroll = await readScroll();
  if (!scroll.scrollable || scroll.scrollTop <= 0 || !scroll.lastVisible)
    throw new Error("The end of a long font list could not be browsed: " + JSON.stringify(scroll));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const settledScroll = await readScroll();
  if (settledScroll.scrollTop <= 0 || !settledScroll.lastVisible)
    throw new Error("The font list moved after the queued positioning frame: " + JSON.stringify(settledScroll));
  await lastFont.focus();
  await page.keyboard.press("ArrowDown");
  if (
    !(await menu.getByRole("option", { name: "默认字体", exact: true }).evaluate((el) => el === document.activeElement))
  )
    throw new Error("Keyboard navigation did not wrap across the whole list");
  await menu.getByLabel("搜索字体").fill("Face-424");
  if ((await lastFont.count()) !== 1 || (await menu.getByRole("option").count()) !== 2)
    throw new Error("Searching a PostScript name beyond the previous limit failed");
  await menu.getByLabel("搜索字体").fill("Shared Family");
  if ((await menu.getByRole("option").count()) !== 426) throw new Error("Family search did not return all faces");
  await lastFont.click();
  await menu.waitFor({ state: "detached" });
  await firstButton.click();
  await page.waitForFunction(() => {
    const list = document.querySelector(".semlo-editor-local-font-list");
    const selected = list?.querySelector<HTMLElement>('button[role="option"][aria-selected="true"]');
    if (!list || selected?.getAttribute("aria-label") !== "展示字体 424") return false;
    const row = selected.getBoundingClientRect(),
      bounds = list.getBoundingClientRect();
    return list.scrollTop > 0 && row.top >= bounds.top - 1 && row.bottom <= bounds.bottom + 1;
  });
  await page.keyboard.press("Escape");
  await page.evaluate(() =>
    Object.defineProperty(window, "queryLocalFonts", { configurable: true, writable: true, value: undefined }),
  );
  await firstButton.click();
  await menu.getByText("当前浏览器不支持读取本机字体").waitFor();
  if (await menu.getByRole("option", { name: "恢复字体", exact: true }).count())
    throw new Error("Unavailable API showed fonts from an earlier API");
  if (errors.length) throw new Error(errors.join("; "));
  return {
    automaticRead: true,
    userGesture: true,
    sharedPendingAndCache: true,
    refresh: true,
    staleResults: true,
    permissionDenied: true,
    retry: true,
    allFontsScrollableAndSearchable: true,
    unsupported: true,
  };
}
