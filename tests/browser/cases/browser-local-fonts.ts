async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  await page.evaluate(async () => {
    window.fontCalls = 0;
    window.fontMode = "ok";
    window.fontResolvers = [];
    window.fontErrors = [];
    Object.defineProperty(window, "queryLocalFonts", {
      configurable: true,
      writable: true,
      value: () => {
        window.__semloIncrementFixture("fontCalls");
        if (window.__semloRequireFixture("fontMode") === "denied")
          return Promise.reject(new DOMException("denied", "NotAllowedError"));
        if (window.__semloRequireFixture("fontMode") === "pending")
          return new Promise((resolve) => window.__semloRequireFixture("fontResolvers").push(resolve));
        return Promise.resolve([
          { family: "PingFang SC" },
          { family: "PingFang SC" },
          { family: "思源宋体" },
          { family: 'Quote "Font" \\ Demo' },
          { family: "000813", fullName: "清晰字体 Bold", style: "Bold", postscriptName: "Clear-Bold" },
          { family: "000813", fullName: "清晰字体 Regular", style: "Regular", postscriptName: "Clear-Regular" },
          { family: "000813", fullName: "清晰字体 Bold", style: "Bold", postscriptName: "Clear-Bold" },
          { family: "000814", fullName: "测试字体 Heavy", style: "Heavy" },
          { family: "000814", fullName: "测试字体 Normal", style: "Normal" },
          { family: 'Bad";color:red', fullName: "伪造字体" },
          { family: "UnsafeFamily", fullName: "Injected;<bad>" },
        ]);
      },
    });
    const { createEditor } = await import("/dist/index.js");
    const host = document.createElement("div");
    host.id = "font-test";
    document.body.prepend(host);
    window.fontApi = createEditor({
      element: host,
      content:
        '<p><span style="font-size:22px;color:#f5222d"><strong><a href="https://example.com">abc</a></strong></span>def</p>',
      onError: (error) => window.__semloRequireFixture("fontErrors").push(error.message),
    });
  });
  const host = page.locator("#font-test"),
    prose = host.locator(".semlo-editor-prose");
  await prose.locator("p").click();
  await page.keyboard.press("Home");
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowRight");
  await host.getByRole("button", { name: "字体", exact: true }).click();
  let menu = page.getByRole("dialog", { name: "选择字体" });
  if ((await page.evaluate(() => window.__semloRequireFixture("fontCalls"))) !== 1)
    throw new Error("Opening the menu did not automatically query local fonts");
  if (await menu.getByRole("radio").count()) throw new Error("Font scope controls should not be shown");
  await menu.getByRole("option", { name: "PingFang SC", exact: true }).waitFor();
  await menu.getByLabel("搜索字体").fill("ping");
  if ((await menu.getByRole("option", { name: "PingFang SC", exact: true }).count()) !== 1)
    throw new Error("Font search or deduplication failed");
  await menu.getByRole("option", { name: "PingFang SC", exact: true }).click();
  const selected = prose.locator('span[style*="font-family"]');
  if ((await selected.innerText()) !== "abc") throw new Error("Font did not apply to the selected text");
  const saved = await page.evaluate(() => window.__semloRequireFixture("fontApi").getSnapshot());
  if (
    !saved.html.includes("font-family") ||
    !saved.html.includes("font-size") ||
    !saved.html.includes("color:") ||
    !JSON.stringify(saved.json).includes("PingFang SC") ||
    !saved.html.includes("<strong>") ||
    !saved.html.includes("href=")
  )
    throw new Error("Font style or existing marks missing from JSON or HTML");
  const roundtrip = await page.evaluate((snapshot) => {
    window.__semloRequireFixture("fontApi").setContent("<p>reset</p>");
    window.__semloRequireFixture("fontApi").setContent(snapshot.html);
    const original = snapshot.json.content![0].content!.find((item) => item.text === "abc");
    const restored = window
      .__semloRequireFixture("fontApi")
      .getSnapshot()
      .json.content![0].content!.find((item) => item.text === "abc");
    const before = original?.marks?.find((mark) => mark.type === "textStyle")?.attrs;
    const after = restored?.marks?.find((mark) => mark.type === "textStyle")?.attrs;
    const color = (value: string | undefined) => {
      const span = document.createElement("span");
      span.style.color = value ?? "";
      return span.style.color;
    };
    return (
      !!after &&
      after.fontFamily === before?.fontFamily &&
      after.semloEditorFontName === before?.semloEditorFontName &&
      after.fontSize === before?.fontSize &&
      color(after.color) === color(before?.color) &&
      restored.marks!.some((mark) => mark.type === "bold") &&
      restored.marks!.some((mark) => mark.type === "link" && mark.attrs!.href === "https://example.com")
    );
  }, saved);
  if (!roundtrip) throw new Error("Font HTML roundtrip failed");
  const rejectsUnknown = await page.evaluate((html) => {
    window.__semloRequireFixture("fontApi").setContent("<p>keep</p>");
    window
      .__semloRequireFixture("fontApi")
      .setContent('<p><span style="font-family:Arial"><unknown-element>bad</unknown-element></span></p>');
    const rejected =
      window.__semloRequireFixture("fontApi").getSnapshot().text === "keep" &&
      window.__semloRequireFixture("fontErrors").some((message) => message.includes("Invalid HTML"));
    window.__semloRequireFixture("fontApi").setContent(html);
    return rejected;
  }, saved.html);
  if (!rejectsUnknown) throw new Error("Strict HTML validation accepted an unknown element inside styled text");
  await prose.locator("p").click();
  const namedSelection = await prose.locator("p").evaluate((el) => {
    const text = el.querySelector("strong")!.firstChild!,
      range = document.createRange();
    range.setStart(text!, 0);
    range.setEnd(text!, 3);
    const selected = window.getSelection()!;
    selected.removeAllRanges();
    selected.addRange(range);
    return selected.toString();
  });
  if (namedSelection !== "abc") throw new Error("Test did not select text for the named font");
  await host.getByRole("button", { name: "字体", exact: true }).click();
  if ((await page.evaluate(() => window.__semloRequireFixture("fontCalls"))) !== 1)
    throw new Error("Reopening the menu unnecessarily queried fonts again");
  await menu.getByLabel("搜索字体").fill("清晰字体");
  if (
    (await menu.getByRole("option", { name: "清晰字体 Regular", exact: true }).count()) !== 1 ||
    (await menu.getByRole("option", { name: "清晰字体 Bold", exact: true }).count()) !== 1
  )
    throw new Error("Different faces were collapsed or a duplicate PostScript name was shown");
  await menu.getByLabel("搜索字体").fill("Clear-Bold");
  if (
    (await menu.getByRole("option", { name: "清晰字体 Bold", exact: true }).count()) !== 1 ||
    (await menu.getByRole("option", { name: "清晰字体 Regular", exact: true }).count())
  )
    throw new Error("PostScript name search did not find the intended face");
  await menu.getByRole("option", { name: "清晰字体 Bold", exact: true }).click();
  const boldAttrs = await page.evaluate(
    () =>
      window
        .__semloRequireFixture("fontApi")
        .getSnapshot()
        .json.content![0].content!.find((item) => item.text === "abc")
        ?.marks?.find((mark) => mark.type === "textStyle")?.attrs,
  );
  if (boldAttrs?.fontFamily !== '"Clear-Bold"' || boldAttrs.semloEditorFontName !== "清晰字体 Bold")
    throw new Error("Bold face did not use its PostScript name: " + JSON.stringify(boldAttrs));
  const reselectABC = async () => {
    await prose.locator("p").click();
    const selected = await prose.locator("p").evaluate((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let text;
      while ((text = walker.nextNode())) {
        const start = (text.textContent ?? "").indexOf("abc");
        if (start < 0) continue;
        const range = document.createRange();
        range.setStart(text!, start);
        range.setEnd(text!, start + 3);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        return selection.toString();
      }
      return "";
    });
    if (selected !== "abc") throw new Error("Could not reselect text for another font face");
  };
  await reselectABC();
  await host.getByRole("button", { name: "字体", exact: true }).click();
  await menu.getByLabel("搜索字体").fill("测试字体");
  if (
    (await menu.getByRole("option", { name: "测试字体 Normal", exact: true }).count()) !== 1 ||
    (await menu.getByRole("option", { name: "测试字体 Heavy", exact: true }).count()) !== 1
  )
    throw new Error("Fallback faces without PostScript names were collapsed");
  await menu.getByRole("option", { name: "测试字体 Normal", exact: true }).click();
  const fallbackAttrs = await page.evaluate(
    () =>
      window
        .__semloRequireFixture("fontApi")
        .getSnapshot()
        .json.content![0].content!.find((item) => item.text === "abc")
        ?.marks?.find((mark) => mark.type === "textStyle")?.attrs,
  );
  if (fallbackAttrs?.fontFamily !== '"000814"' || fallbackAttrs.semloEditorFontName !== "测试字体 Normal")
    throw new Error("A face without PostScript name did not fall back to its family: " + JSON.stringify(fallbackAttrs));
  await reselectABC();
  await host.getByRole("button", { name: "字体", exact: true }).click();
  await menu.getByLabel("搜索字体").fill("000813");
  if ((await menu.getByRole("option", { name: /清晰字体/ }).count()) !== 2)
    throw new Error("Family search did not return both faces");
  await menu.getByRole("option", { name: "清晰字体 Regular", exact: true }).click();
  const numeric = await page.evaluate(() => window.__semloRequireFixture("fontApi").getSnapshot());
  const numericAttrs = numeric.json
    .content![0].content!.find((item) => item.text === "abc")
    ?.marks?.find((mark) => mark.type === "textStyle")?.attrs;
  if (numericAttrs?.fontFamily !== '"Clear-Regular"' || numericAttrs.semloEditorFontName !== "清晰字体 Regular")
    throw new Error("Regular face or readable name was not stored correctly: " + JSON.stringify(numericAttrs));
  if (!(await host.getByRole("button", { name: "字体", exact: true }).innerText()).includes("清晰字体 Regular"))
    throw new Error("Font toolbar displayed an opaque family instead of the full name");
  if (!numeric.html.includes('data-semlo-editor-font-name="清晰字体 Regular"'))
    throw new Error("Readable font name missing from HTML");
  const numericRoundtrip = await page.evaluate(
    ({ html, expectedFamily }) => {
      window.__semloRequireFixture("fontApi").setContent("<p>reset</p>");
      window.__semloRequireFixture("fontApi").setContent(html);
      const attrs = window
        .__semloRequireFixture("fontApi")
        .getSnapshot()
        .json.content![0].content!.find((item) => item.text === "abc")
        ?.marks?.find((mark) => mark.type === "textStyle")?.attrs;
      const normalize = (value: string | undefined) => {
        const span = document.createElement("span");
        span.style.fontFamily = value ?? "";
        return span.style.fontFamily;
      };
      return { attrs, familyMatches: normalize(attrs?.fontFamily) === normalize(expectedFamily) };
    },
    { html: numeric.html, expectedFamily: numericAttrs?.fontFamily },
  );
  if (!numericRoundtrip.familyMatches || numericRoundtrip.attrs?.semloEditorFontName !== "清晰字体 Regular")
    throw new Error("Readable font name was lost in HTML roundtrip");
  const commands = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("fontApi").editor;
    editor.commands.setTextSelection({ from: 1, to: 4 });
    editor.commands.setFontFamily("Arial");
    const changed = { ...editor.getAttributes("textStyle") };
    editor.commands.unsetFontFamily();
    const cleared = { ...editor.getAttributes("textStyle") };
    return { changed, cleared };
  });
  if (
    commands.changed.fontFamily !== "Arial" ||
    commands.changed.semloEditorFontName ||
    commands.cleared.fontFamily ||
    commands.cleared.semloEditorFontName ||
    commands.changed.fontSize !== "22px" ||
    commands.cleared.fontSize !== "22px" ||
    !commands.cleared.color
  )
    throw new Error(
      "Font commands did not clear the old display name or preserve other text styles: " + JSON.stringify(commands),
    );
  await page.evaluate((html) => window.__semloRequireFixture("fontApi").setContent(html), numeric.html);
  await prose.locator("p").click();
  await page.keyboard.press("Home");
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowRight");
  await host.getByRole("button", { name: "字体", exact: true }).click();
  await menu.getByRole("option", { name: "默认字体", exact: true }).click();
  if (await prose.locator('span[style*="font-family"]').count())
    throw new Error("Default font did not remove the selected family");
  const defaultAttrs = await page.evaluate(
    () =>
      window
        .__semloRequireFixture("fontApi")
        .getSnapshot()
        .json.content![0].content!.find((item) => item.text === "abc")
        ?.marks?.find((mark) => mark.type === "textStyle")?.attrs,
  );
  if (defaultAttrs?.fontFamily || defaultAttrs?.semloEditorFontName)
    throw new Error("Default font left a stored family or display name");

  await prose.locator("p").click();
  const specialSelection = await prose.locator("p").evaluate((el) => {
    const text = el.querySelector("strong")!.firstChild!,
      range = document.createRange();
    range.setStart(text!, 0);
    range.setEnd(text!, 3);
    const selected = window.getSelection()!;
    selected.removeAllRanges();
    selected.addRange(range);
    return selected.toString();
  });
  if (specialSelection !== "abc") throw new Error("Test did not select text for the quoted font");
  await host.getByRole("button", { name: "字体", exact: true }).click();
  await menu.getByRole("option", { name: "思源宋体", exact: true }).waitFor();
  if (await menu.getByRole("option", { name: /Bad|伪造字体|Injected|UnsafeFamily/ }).count())
    throw new Error("Unsafe font family or full name was offered");
  await menu.getByRole("option", { name: 'Quote "Font" \\ Demo', exact: true }).click();
  const escapedRoundtrip = await page.evaluate(() => {
    const snapshot = window.__semloRequireFixture("fontApi").getSnapshot();
    const family = (json: import("@tiptap/core").JSONContent) =>
      json.content![0].content!.find((item) => item.text === "abc")?.marks?.find((mark) => mark.type === "textStyle")
        ?.attrs?.fontFamily;
    const normalize = (value: string | undefined) => {
      const span = document.createElement("span");
      span.style.fontFamily = value ?? "";
      return span.style.fontFamily;
    };
    const before = family(snapshot.json);
    window.__semloRequireFixture("fontApi").setContent("<p>reset</p>");
    window.__semloRequireFixture("fontApi").setContent(snapshot.html);
    const restored = window.__semloRequireFixture("fontApi").getSnapshot().json;
    const name = restored
      .content![0].content!.find((item) => item.text === "abc")
      ?.marks?.find((mark) => mark.type === "textStyle")?.attrs?.semloEditorFontName;
    return !!before && normalize(before) === normalize(family(restored)) && name === 'Quote "Font" \\ Demo';
  });
  if (!escapedRoundtrip) throw new Error("Quoted font name did not survive HTML roundtrip");
  await page.evaluate(() => window.__semloRequireFixture("fontApi").setContent("<p></p>"));
  await prose.locator("p").click();
  await host.getByRole("button", { name: "字体", exact: true }).click();
  await menu.getByRole("option", { name: "PingFang SC", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.matches("#font-test .semlo-editor-prose"));
  await page.keyboard.type("x");
  if (
    (await page.evaluate(
      () => window.__semloRequireFixture("fontApi").getSnapshot().json.attrs?.semloEditorDocumentFontFamily,
    )) !== "PingFang SC" ||
    !(await prose.getByText("x").count())
  )
    throw new Error("Choosing a font at a cursor did not change the document font");
  const selectX = async () => {
    await prose.locator("p").click();
    const selection = await prose.locator("p").evaluate((el) => {
      const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode(),
        range = document.createRange();
      range.setStart(text!, 0);
      range.setEnd(text!, 1);
      const selected = window.getSelection()!;
      selected.removeAllRanges();
      selected.addRange(range);
      return selected.toString();
    });
    if (selection !== "x") throw new Error("Test did not select the intended character");
  };
  await host.getByRole("button", { name: "字体", exact: true }).click();
  await page.keyboard.press("Escape");
  if (await menu.count()) throw new Error("Escape left font picker open");
  await page.evaluate(() => {
    window.fontMode = "denied";
  });
  await selectX();
  await host.getByRole("button", { name: "字体", exact: true }).click();
  await menu.getByRole("button", { name: "刷新本机字体" }).click();
  await menu.getByText("字体访问被拒绝，请检查浏览器权限").waitFor();
  if (
    (await menu.getByLabel("手动输入字体名称").count()) ||
    (await menu.getByRole("button", { name: "应用字体" }).count())
  )
    throw new Error("The removed manual font form is still shown");
  await page.evaluate(() => {
    window.fontMode = "ok";
  });
  await menu.getByRole("button", { name: "刷新本机字体" }).click();
  await menu.getByRole("option", { name: "思源宋体", exact: true }).click();
  if (
    !(await prose
      .locator('span[style*="font-family"]')
      .evaluate(
        (el) =>
          el.style.fontFamily.includes("思源宋体") && el.getAttribute("data-semlo-editor-font-name") === "思源宋体",
      ))
  )
    throw new Error("The selected font was not applied after retrying");
  await page.evaluate(() => {
    Object.defineProperty(window, "queryLocalFonts", { configurable: true, writable: true, value: undefined });
  });
  await selectX();
  await host.getByRole("button", { name: "字体", exact: true }).click();
  await menu.getByText("当前浏览器不支持读取本机字体").waitFor();
  if (await menu.getByRole("button", { name: "刷新本机字体" }).count())
    throw new Error("Unavailable API still offered refresh");
  await menu.getByRole("option", { name: "默认字体", exact: true }).click();
  if (await prose.locator('span[style*="font-family"]').count())
    throw new Error("Default font was unavailable without the API");
  await page.evaluate(() => {
    window.queryLocalFonts = () => {
      window.__semloIncrementFixture("fontCalls");
      return new Promise((resolve) => window.__semloRequireFixture("fontResolvers").push(resolve));
    };
  });
  await host.getByRole("button", { name: "字体", exact: true }).click();
  await menu.getByText(/仍在等待浏览器授权.*Chrome/).waitFor({ timeout: 8000 });
  if (await menu.getByRole("button", { name: "刷新本机字体" }).isDisabled())
    throw new Error("A stalled request did not allow an explicit retry");
  await menu.getByRole("button", { name: "刷新本机字体" }).focus();
  await page.evaluate(() => window.__semloRequireFixture("fontResolvers").shift()!([{ family: "延迟字体" }]));
  await menu.getByRole("option", { name: "延迟字体", exact: true }).waitFor();
  if (!(await menu.getByRole("button", { name: "刷新本机字体" }).evaluate((el) => el === document.activeElement)))
    throw new Error("Late permission result stole focus from refresh");
  await page.keyboard.press("Escape");
  await selectX();
  await host.getByRole("button", { name: "字体", exact: true }).click();
  await menu.getByRole("button", { name: "刷新本机字体" }).click();
  await menu.getByRole("option", { name: "延迟字体", exact: true }).click();
  const beforeLate = await page.evaluate(() =>
    JSON.stringify(window.__semloRequireFixture("fontApi").getSnapshot().json),
  );
  await page.evaluate(() => window.__semloRequireFixture("fontResolvers").shift()!([{ family: "不应出现" }]));
  await page.waitForTimeout(30);
  if (
    (await menu.count()) ||
    (await page.evaluate(() => JSON.stringify(window.__semloRequireFixture("fontApi").getSnapshot().json))) !==
      beforeLate
  )
    throw new Error("A late result changed the selected font");
  await host.getByRole("button", { name: "字体", exact: true }).click();
  await menu.getByRole("button", { name: "刷新本机字体" }).click();
  await page.evaluate(() => window.__semloRequireFixture("fontApi").setEditable(false));
  if (await menu.count()) throw new Error("Read-only transition left font picker open");
  await page.evaluate(() => {
    window.__semloRequireFixture("fontResolvers").shift()!([{ family: "延迟字体" }]);
    window.__semloRequireFixture("fontApi").setEditable(true);
  });
  await page.waitForTimeout(30);
  if (await menu.count()) throw new Error("Late font result reopened the picker");
  await host.getByRole("button", { name: "字体", exact: true }).click();
  await menu.getByRole("button", { name: "刷新本机字体" }).click();
  await page.evaluate(() => {
    window.__semloRequireFixture("fontApi").destroy();
    document.querySelector("#font-test")!.remove();
    window.__semloRequireFixture("fontResolvers").shift()!([{ family: "延迟字体" }]);
  });
  if (await menu.count()) throw new Error("Destroy left font picker open");

  await page.evaluate(() => {
    window.queryLocalFonts = () =>
      Promise.resolve([{ family: "000813", fullName: "清晰字体 Regular", style: "Regular" }]);
  });
  const demo = page.locator("#editor-host");
  const paragraph = demo.locator(".semlo-editor-prose > p").last();
  await paragraph.click();
  await page.keyboard.type("sample");
  await page.keyboard.press("Home");
  for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowRight");
  await demo.getByRole("button", { name: "字体", exact: true }).click();
  await menu.getByRole("option", { name: "清晰字体 Regular", exact: true }).click();
  for (const framework of ["React", "SolidJS", "Vue"]) {
    await page.getByRole("button", { name: framework, exact: true }).click();
    const text = demo
      .locator('.semlo-editor-prose span[data-semlo-editor-font-name="清晰字体 Regular"]')
      .getByText("sample");
    if (!(await text.count())) throw new Error(`${framework}: font style or readable name lost`);
    await text.click();
    await page.waitForFunction(() =>
      document.querySelector("#editor-host .semlo-editor-font-family")?.textContent?.includes("清晰字体 Regular"),
    );
  }
  await page.goto(new URL("/tests/controlled.html", page.url()).href);
  await page.evaluate(() => {
    window.fontCalls = 0;
    Object.defineProperty(window, "queryLocalFonts", {
      configurable: true,
      writable: true,
      value: () => {
        window.__semloIncrementFixture("fontCalls");
        return Promise.resolve([{ family: "PingFang SC" }]);
      },
    });
  });
  for (const framework of ["react", "vue", "solid"]) {
    const controlled = page.locator(`#${framework}`),
      paragraph = controlled.locator(".semlo-editor-column p").first();
    await paragraph.click();
    await page.keyboard.type("abc");
    const selection = await paragraph.evaluate((el) => {
      const text = el.firstChild,
        range = document.createRange();
      range.setStart(text!, 0);
      range.setEnd(text!, 3);
      const selected = window.getSelection()!;
      selected.removeAllRanges();
      selected.addRange(range);
      return selected.toString();
    });
    if (selection !== "abc") throw new Error(`${framework}: test did not select the intended text`);
    await controlled.getByRole("button", { name: "字体", exact: true }).click();
    await menu.getByRole("option", { name: "PingFang SC", exact: true }).click();
    if (!(await controlled.locator('.semlo-editor-column span[style*="font-family"]').getByText("abc").count()))
      throw new Error(`${framework}: controlled font update lost`);
  }
  if ((await page.evaluate(() => window.__semloRequireFixture("fontCalls"))) !== 1)
    throw new Error("Separately bundled framework adapters did not share the window cache");
  if (errors.length) throw new Error(errors.join("; "));
  return {
    automaticReadAndCache: true,
    selection: true,
    search: true,
    separateFacesAndFamilyFallback: true,
    sanitized: true,
    jsonAndHtml: true,
    escapedName: true,
    cursorChangesDocument: true,
    refreshRetry: true,
    permissionWait: true,
    lateResult: true,
    default: true,
    denied: true,
    unsupported: true,
    readOnlyAndDestroy: true,
    frameworks: ["React", "SolidJS", "Vue"],
    controlled: true,
  };
}
