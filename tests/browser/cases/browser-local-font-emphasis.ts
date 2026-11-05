async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const origin = new URL("/", page.url()).origin;
  await page.goto(origin + "/");
  if (!(await page.evaluate(() => typeof window.queryLocalFonts === "function")))
    return { skipped: "Local Font Access is unavailable" };
  await page.context().grantPermissions(["local-fonts"], { origin });
  await page.evaluate(async () => {
    // A host can disable synthesis globally; the editor must still support emphasis.
    document.documentElement.style.fontSynthesis = "none";
    const original = window.__semloRequireFixture("queryLocalFonts").bind(window);
    window.emphasisOriginal = () => {
      window.emphasisRequest = { status: "pending" };
      try {
        return original().then(
          (fonts) => {
            window.emphasisFonts = fonts;
            return fonts;
          },
          (error: unknown) => {
            window.emphasisRequest = { status: "rejected", message: String(error) };
            throw error;
          },
        );
      } catch (error) {
        window.emphasisRequest = { status: "rejected", message: String(error) };
        throw error;
      }
    };
    window.queryLocalFonts = window.__semloRequireFixture("emphasisOriginal");
    const { createEditor } = await import("/dist/index.js");
    window.emphasisCreate = createEditor;
    const host = document.createElement("div");
    host.id = "emphasis-first";
    document.body.prepend(host);
    window.emphasisFirst = createEditor({ element: host, content: "<p>天地玄黄 ABCdef 123</p>" });
    const style = document.createElement("style");
    style.textContent =
      "#emphasis-first .semlo-editor-prose p,#emphasis-second .semlo-editor-prose p{font-size:42px;line-height:1.5}";
    document.head.append(style);
  });
  const host = page.locator("#emphasis-first"),
    paragraph = host.locator(".semlo-editor-prose p");
  const toolbar = host.locator(".semlo-editor-toolbar"),
    fontButton = toolbar.getByRole("button", { name: "字体", exact: true });
  const menu = page.getByRole("dialog", { name: "选择字体" });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const platformFonts = async (selector: string): Promise<Array<string | undefined>> => {
    const { root } = await cdp.send("DOM.getDocument");
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error("Missing font probe node: " + selector);
    const result = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
    return result.fonts.map((font) => font.postScriptName);
  };
  const capture = async () => {
    await page.evaluate(() => {
      document.getSelection()!.removeAllRanges();
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await page.evaluate(() => document.fonts.ready);
    return paragraph.screenshot();
  };
  const setSelection = async (from: number, to = from) =>
    page.evaluate(
      ({ from, to }) => {
        window.__semloRequireFixture("emphasisFirst").editor.commands.focus();
        window.__semloRequireFixture("emphasisFirst").editor.commands.setTextSelection({ from, to });
      },
      { from, to },
    );
  const toggle = async (name: string) => {
    await setSelection(1, 16);
    await toolbar.getByRole("button", { name, exact: true }).click();
  };
  const choose = async (name: string | undefined) => {
    if (name === undefined) throw new Error("Selected local font has no full name");
    await fontButton.click();
    await menu.getByLabel("搜索字体").fill(name);
    const option = menu.getByRole("option", { name, exact: true });
    if ((await option.count()) !== 1) throw new Error("Expected one font option: " + name);
    await option.click();
  };
  await paragraph.click();
  await fontButton.click();
  try {
    await page.waitForFunction(
      () => Array.isArray(window.emphasisFonts) || window.emphasisRequest?.status === "rejected",
      undefined,
      { timeout: 8000 },
    );
  } catch (error) {
    const request = await page.evaluate(() => window.emphasisRequest);
    if (error instanceof Error && error.name === "TimeoutError" && request?.status === "pending") {
      await cdp.detach();
      if (errors.length) throw new Error(errors.join("; "));
      return { skipped: "Native local font enumeration did not settle within 8 seconds" };
    }
    throw error;
  }
  const rejection = await page.evaluate(() => window.emphasisRequest);
  if (rejection?.status === "rejected") throw new Error(`Native local font enumeration failed: ${rejection.message}`);
  const real = await page.evaluate(() => {
    const find = (postscriptName: string) => {
      const font = window.__semloRequireFixture("emphasisFonts").find((item) => item.postscriptName === postscriptName);
      return font && { family: font.family, name: font.fullName, ps: font.postscriptName, style: font.style };
    };
    const fonts = window
      .__semloRequireFixture("emphasisFonts")
      .filter(
        (item): item is typeof item & { postscriptName: string; fullName: string; style: string } =>
          !!(item.family && item.postscriptName && item.fullName && item.style),
      );
    const kind = (style: string) => style.toLowerCase().replace(/[\s_-]+/g, "");
    const single =
      find("STKaiti") ??
      fonts
        .filter((item) => ["regular", "normal"].includes(kind(item.style)))
        .map((item) => find(item.postscriptName))[0];
    let regular = find("STKaitiSC-Regular"),
      bold = find("STKaitiSC-Bold");
    if (!regular || !bold) {
      for (const candidate of fonts) {
        if (!["regular", "normal"].includes(kind(candidate.style))) continue;
        const matches = fonts.filter((item) => item.family === candidate.family && kind(item.style) === "bold");
        if (matches.length !== 1) continue;
        regular = find(candidate.postscriptName);
        bold = find(matches[0].postscriptName);
        break;
      }
    }
    const richer = {
      regular: find("Georgia"),
      bold: find("Georgia-Bold"),
      italic: find("Georgia-Italic"),
      boldItalic: find("Georgia-BoldItalic"),
    };
    return {
      single,
      regular,
      bold,
      richer:
        richer.regular && richer.bold && richer.italic && richer.boldItalic
          ? { regular: richer.regular, bold: richer.bold, italic: richer.italic, boldItalic: richer.boldItalic }
          : null,
    };
  });
  if (!real.single || !real.regular || !real.bold) {
    await cdp.detach();
    if (errors.length) throw new Error(errors.join("; "));
    return { skipped: "No usable regular/bold local font family was found" };
  }
  await page.keyboard.press("Escape");
  await page.evaluate((font) => {
    window.queryLocalFonts = () =>
      Promise.resolve([{ family: font.family, fullName: font.name, postscriptName: font.ps, style: font.style }]);
  }, real.single);
  await setSelection(1);
  await choose(real.single.name);
  const singleNormal = await capture();
  await toggle("加粗");
  const singleBold = await capture();
  if (singleNormal.equals(singleBold)) throw new Error("A single-face font did not visually become bold");
  if (!(await platformFonts("#emphasis-first .semlo-editor-prose strong")).includes(real.single.ps))
    throw new Error("Synthetic bold lost the chosen face");
  await page.waitForTimeout(600);
  await toggle("斜体");
  const singleBoth = await capture();
  if (singleBold.equals(singleBoth)) throw new Error("Synthetic italic did not visibly combine with bold");
  if (!(await platformFonts("#emphasis-first .semlo-editor-prose strong")).includes(real.single.ps))
    throw new Error("Bold italic lost the single chosen face");
  let snapshot = await page.evaluate(() => window.__semloRequireFixture("emphasisFirst").getSnapshot());
  if (
    !snapshot.html.includes("<strong>") ||
    !snapshot.html.includes("<em>") ||
    snapshot.json.attrs!.semloEditorDocumentFontFamily !== real.single.ps
  )
    throw new Error("Document font or emphasis marks were not serialized");
  await page.evaluate(() => window.__semloRequireFixture("emphasisFirst").editor.commands.undo());
  let marks = await page.evaluate(() =>
    window
      .__semloRequireFixture("emphasisFirst")
      .getSnapshot()
      .json.content![0].content![0].marks!.map((mark) => mark.type),
  );
  if (!marks.includes("bold") || marks.includes("italic"))
    throw new Error("Undo did not remove just the later italic mark");
  await page.evaluate(() => window.__semloRequireFixture("emphasisFirst").editor.commands.redo());
  marks = await page.evaluate(() =>
    window
      .__semloRequireFixture("emphasisFirst")
      .getSnapshot()
      .json.content![0].content![0].marks!.map((mark) => mark.type),
  );
  if (!marks.includes("bold") || !marks.includes("italic")) throw new Error("Redo did not restore both emphasis marks");

  // A second editor shares the same registered face; destroying one cannot remove it from the other.
  snapshot = await page.evaluate(() => window.__semloRequireFixture("emphasisFirst").getSnapshot());
  const alias = await host.locator(".semlo-editor-prose").getAttribute("data-semlo-editor-document-face");
  if (!alias) throw new Error("The selected font alias is missing");
  await page.evaluate((content) => {
    const host = document.createElement("div");
    host.id = "emphasis-second";
    document.body.append(host);
    window.emphasisSecond = window.__semloRequireFixture("emphasisCreate")({ element: host, content });
  }, snapshot.json);
  if (
    (await page.locator("#emphasis-second .semlo-editor-prose").getAttribute("data-semlo-editor-document-face")) !==
    alias
  )
    throw new Error("Editors did not share the same face alias");
  await page.evaluate(() => window.__semloRequireFixture("emphasisFirst").destroy());
  if (!(await page.evaluate((alias) => Array.from(document.fonts).some((face) => face.family === alias), alias)))
    throw new Error("Destroying one editor removed a face still used by another");
  if (!(await platformFonts("#emphasis-second .semlo-editor-prose strong")).includes(real.single.ps))
    throw new Error("The surviving editor lost its rendered font");
  await page.evaluate(() => window.__semloRequireFixture("emphasisSecond").destroy());
  if (
    await page.evaluate(
      (alias) =>
        Array.from(document.fonts).some((face) => face.family === alias) ||
        Array.from(document.querySelectorAll("style[data-semlo-editor-local-fonts]")).some((style) =>
          style.textContent?.includes(alias),
        ),
      alias,
    )
  )
    throw new Error("The last editor left a font face or CSS rule behind");

  await page.evaluate(() => {
    window.queryLocalFonts = window.__semloRequireFixture("emphasisOriginal");
    window.emphasisFirst = window.__semloRequireFixture("emphasisCreate")({
      element: document.querySelector<HTMLElement>("#emphasis-first")!,
      content: "<p>天地玄黄 ABCdef 123</p>",
    });
  });
  await setSelection(1);
  await choose(real.bold.name);
  const boldNormal = await capture();
  await toggle("斜体");
  const boldItalic = await capture();
  if (boldNormal.equals(boldItalic)) throw new Error("The chosen bold face did not visibly slant");
  if (!(await platformFonts("#emphasis-first .semlo-editor-prose em")).includes(real.bold.ps))
    throw new Error("Italic changed the selected bold face to a lighter face");
  snapshot = await page.evaluate(() => window.__semloRequireFixture("emphasisFirst").getSnapshot());
  await page.context().clearPermissions();
  for (const content of [snapshot.json, snapshot.html]) {
    await page.evaluate((value) => {
      window.__semloRequireFixture("emphasisFirst").setContent("<p>reset</p>");
      window.__semloRequireFixture("emphasisFirst").setContent(value);
    }, content);
    await page.evaluate(() => document.fonts.ready);
    if (!(await platformFonts("#emphasis-first .semlo-editor-prose em")).includes(real.bold.ps))
      throw new Error("JSON/HTML roundtrip lost the chosen bold face");
  }

  await page.context().grantPermissions(["local-fonts"], { origin });
  await page.evaluate(() => window.__semloRequireFixture("emphasisFirst").setContent("<p>天地玄黄 ABCdef 123</p>"));
  await setSelection(1);
  await choose(real.regular.name);
  snapshot = await page.evaluate(() => window.__semloRequireFixture("emphasisFirst").getSnapshot());
  if (
    snapshot.json.attrs!.semloEditorDocumentFontVariants?.bold !== real.bold.ps ||
    !snapshot.html.includes("data-semlo-editor-document-font-variants")
  )
    throw new Error("The unique real bold sibling was not persisted");
  await toggle("加粗");
  await capture();
  if (!(await platformFonts("#emphasis-first .semlo-editor-prose strong")).includes(real.bold.ps))
    throw new Error("A known native bold sibling was not used");
  snapshot = await page.evaluate(() => window.__semloRequireFixture("emphasisFirst").getSnapshot());
  const reloadSnapshot = snapshot;
  for (const content of [snapshot.json, snapshot.html]) {
    await page.evaluate((value) => {
      window.__semloRequireFixture("emphasisFirst").setContent("<p>reset</p>");
      window.__semloRequireFixture("emphasisFirst").setContent(value);
    }, content);
    await page.evaluate(() => document.fonts.ready);
    if (!(await platformFonts("#emphasis-first .semlo-editor-prose strong")).includes(real.bold.ps))
      throw new Error("Roundtrip lost the native bold mapping");
  }

  if (real.richer) {
    await page.evaluate(() => window.__semloRequireFixture("emphasisFirst").setContent("<p>天地玄黄 ABCdef 123</p>"));
    await setSelection(1);
    await choose(real.richer.regular.name);
    snapshot = await page.evaluate(() => window.__semloRequireFixture("emphasisFirst").getSnapshot());
    const variants = snapshot.json.attrs!.semloEditorDocumentFontVariants;
    if (
      variants?.bold !== real.richer.bold.ps ||
      variants?.italic !== real.richer.italic.ps ||
      variants?.boldItalic !== real.richer.boldItalic.ps
    )
      throw new Error("Real bold/italic variants were not preserved");
    await toggle("斜体");
    await capture();
    if (!(await platformFonts("#emphasis-first .semlo-editor-prose em")).includes(real.richer.italic.ps))
      throw new Error("A known native italic sibling was not used");
    await toggle("加粗");
    await capture();
    if (!(await platformFonts("#emphasis-first .semlo-editor-prose em")).includes(real.richer.boldItalic.ps))
      throw new Error("A known native bold-italic sibling was not used");
    await page.evaluate(() => window.__semloRequireFixture("emphasisFirst").setContent("<p>天地玄黄 ABCdef 123</p>"));
    await setSelection(1);
    await choose(real.richer.italic.name);
    await toggle("加粗");
    await capture();
    if (!(await platformFonts("#emphasis-first .semlo-editor-prose strong")).includes(real.richer.boldItalic.ps))
      throw new Error("Adding bold to the selected italic face lost its italic style");
    await page.evaluate(() => window.__semloRequireFixture("emphasisFirst").setContent("<p>天地玄黄 ABCdef 123</p>"));
    await setSelection(1);
    await choose(real.richer.bold.name);
    await toggle("斜体");
    await capture();
    if (!(await platformFonts("#emphasis-first .semlo-editor-prose em")).includes(real.richer.boldItalic.ps))
      throw new Error("Adding italic to a selected bold face missed its real bold-italic sibling");
  }

  // An inline face in a mixed selection retains its mapping and its selected scope.
  await page.evaluate(() => window.__semloRequireFixture("emphasisFirst").setContent("<p>天地玄黄 ABCdef 123</p>"));
  await setSelection(1, 5);
  await choose(real.regular.name);
  await toggle("加粗");
  await page.waitForTimeout(600);
  await toggle("斜体");
  snapshot = await page.evaluate(() => window.__semloRequireFixture("emphasisFirst").getSnapshot());
  const text = snapshot.json.content![0].content!;
  const firstStyle = text[0].marks!.find((mark) => mark.type === "textStyle")?.attrs;
  if (
    !firstStyle?.fontFamily.includes(real.regular.ps) ||
    firstStyle.semloEditorFontVariants?.bold !== real.bold.ps ||
    text.some(
      (node) =>
        !node.marks?.some((mark) => mark.type === "bold") || !node.marks?.some((mark) => mark.type === "italic"),
    )
  )
    throw new Error("Mixed selection lost its local face or emphasis: " + JSON.stringify(text));
  if (
    snapshot.json.attrs!.semloEditorDocumentFontFamily ||
    text.slice(1).some((node) => node.marks?.some((mark) => mark.type === "textStyle" && mark.attrs!.fontFamily))
  )
    throw new Error("A selected-text font changed the rest of the document");
  for (const content of [snapshot.json, snapshot.html]) {
    await page.evaluate((value) => {
      window.__semloRequireFixture("emphasisFirst").setContent("<p>reset</p>");
      window.__semloRequireFixture("emphasisFirst").setContent(value);
    }, content);
    await page.evaluate(() => document.fonts.ready);
    if (
      !(await platformFonts("#emphasis-first .semlo-editor-prose span[data-semlo-editor-font-name] em")).includes(
        real.bold.ps,
      )
    )
      throw new Error("Inline font variant did not survive roundtrip");
  }
  const inlineAlias = await host
    .locator(".semlo-editor-prose span[data-semlo-editor-local-face]")
    .first()
    .getAttribute("data-semlo-editor-local-face");
  await setSelection(2, 3);
  await page.evaluate(() => window.__semloRequireFixture("emphasisFirst").editor.commands.unsetFontFamily());
  if (!(await page.evaluate((alias) => Array.from(document.fonts).some((face) => face.family === alias), inlineAlias)))
    throw new Error("Removing part of an inline font released a face still in use");
  await setSelection(1, 16);
  await page.evaluate(() => window.__semloRequireFixture("emphasisFirst").editor.commands.unsetAllMarks());
  if (await page.evaluate((alias) => Array.from(document.fonts).some((face) => face.family === alias), inlineAlias))
    throw new Error("Removing the last inline font did not release its face");
  // Ambiguous and unrecognized styles must never be guessed into the map.
  await page.evaluate((font) => {
    window.queryLocalFonts = () =>
      Promise.resolve([
        { family: "Ambiguous", fullName: "Ambiguous Regular", postscriptName: font.ps, style: "Regular" },
        { family: "Ambiguous", fullName: "Ambiguous Bold A", postscriptName: "Missing-Bold-A", style: "Bold" },
        { family: "Ambiguous", fullName: "Ambiguous Bold B", postscriptName: "Missing-Bold-B", style: "Bold" },
        { family: "Ambiguous", fullName: "Ambiguous Medium", postscriptName: "Missing-Medium", style: "Medium" },
      ]);
    window.__semloRequireFixture("emphasisFirst").setContent("<p>天地玄黄 ABCdef 123</p>");
  }, real.regular);
  await setSelection(1);
  await choose("Ambiguous Regular");
  snapshot = await page.evaluate(() => window.__semloRequireFixture("emphasisFirst").getSnapshot());
  if (snapshot.json.attrs!.semloEditorDocumentFontVariants)
    throw new Error("Duplicate bold siblings were guessed into the map");
  await setSelection(1);
  await choose("Ambiguous Medium");
  snapshot = await page.evaluate(() => window.__semloRequireFixture("emphasisFirst").getSnapshot());
  if (snapshot.json.attrs!.semloEditorDocumentFontVariants)
    throw new Error("An unrecognized style was guessed into the map");

  // A missing mapped face falls back without losing readable text or throwing.
  await page.evaluate(
    (font) =>
      window.__semloRequireFixture("emphasisFirst").setContent({
        type: "doc",
        attrs: {
          semloEditorDocumentFontFamily: font.ps,
          semloEditorDocumentFontName: font.name,
          semloEditorDocumentFontVariants: { bold: "Missing-Bold-Face" },
        },
        content: [{ type: "paragraph", content: [{ type: "text", text: "天地玄黄 ABCdef 123" }] }],
      }),
    real.regular,
  );
  await toggle("加粗");
  await capture();
  const fallbackFonts = await platformFonts("#emphasis-first .semlo-editor-prose strong");
  if (!fallbackFonts.includes(real.regular.ps) && !fallbackFonts.includes(real.bold.ps))
    throw new Error("A missing mapped font lost the selected family: " + JSON.stringify(fallbackFonts));
  const beforeInvalid = await page.evaluate(() =>
    JSON.stringify(window.__semloRequireFixture("emphasisFirst").getSnapshot().json),
  );
  await page.evaluate(
    (font) =>
      window.__semloRequireFixture("emphasisFirst").setContent({
        type: "doc",
        attrs: {
          semloEditorDocumentFontFamily: font.ps,
          semloEditorDocumentFontName: font.name,
          semloEditorDocumentFontVariants: { bold: "Bad; color:red" },
        },
        content: [{ type: "paragraph", content: [{ type: "text", text: "bad" }] }],
      }),
    real.regular,
  );
  if (
    (await page.evaluate(() => JSON.stringify(window.__semloRequireFixture("emphasisFirst").getSnapshot().json))) !==
    beforeInvalid
  )
    throw new Error("Unsafe font variant metadata was accepted");
  await page.evaluate(() => window.__semloRequireFixture("emphasisFirst").destroy());

  // A fresh page has no in-memory font registry and does not re-enumerate fonts.
  await page.context().clearPermissions();
  await page.goto(origin + "/");
  await page.evaluate(async (content) => {
    window.unexpectedFontReads = 0;
    window.queryLocalFonts = () => {
      window.__semloIncrementFixture("unexpectedFontReads");
      throw new Error("Unexpected local-font read");
    };
    const { createEditor } = await import("/dist/index.js");
    window.emphasisCreate = createEditor;
    const host = document.createElement("div");
    host.id = "emphasis-reloaded";
    document.body.prepend(host);
    window.emphasisReloaded = createEditor({ element: host, content });
  }, reloadSnapshot.json);
  await page.evaluate(() => document.fonts.ready);
  if (!(await platformFonts("#emphasis-reloaded .semlo-editor-prose strong")).includes(real.bold.ps))
    throw new Error("Reloading JSON did not restore the native bold face");
  await page.evaluate((html) => {
    window.__semloRequireFixture("emphasisReloaded").setContent("<p>reset</p>");
    window.__semloRequireFixture("emphasisReloaded").setContent(html);
  }, reloadSnapshot.html);
  await page.evaluate(() => document.fonts.ready);
  if (
    !(await platformFonts("#emphasis-reloaded .semlo-editor-prose strong")).includes(real.bold.ps) ||
    (await page.evaluate(() => window.__semloRequireFixture("unexpectedFontReads"))) !== 0
  )
    throw new Error("Reloading HTML required font permission or lost its native bold face");
  await page.evaluate(() => window.__semloRequireFixture("emphasisReloaded").destroy());

  // Hold real FontFace loads open while the editor replaces fonts and is destroyed.
  const fixture = await page.context().request.get(origin + "/dist/fonts/KaTeX_Main-Regular.woff2");
  if (!fixture.ok()) throw new Error("Missing local font fixture");
  const bytes = await fixture.body();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requests: string[] = [];
  await page.route("**/__ink_delayed_font_*", async (route) => {
    requests.push(route.request().url());
    await gate;
    try {
      await route.fulfill({ status: 200, contentType: "font/woff2", body: bytes });
    } catch {
      /* Page may be closed. */
    }
  });
  try {
    await page.evaluate(() => {
      const NativeFontFace = window.FontFace;
      let id = 0;
      Object.defineProperty(window, "FontFace", {
        value: function (family: string, source: string | BufferSource, descriptors?: FontFaceDescriptors) {
          return new NativeFontFace(
            family,
            family.startsWith("semlo-editor-local-") ? `url('/__ink_delayed_font_${id++}.woff2')` : source,
            descriptors,
          );
        },
      });
      const host = document.createElement("div");
      host.id = "emphasis-race";
      document.body.prepend(host);
      window.emphasisRace = window.__semloRequireFixture("emphasisCreate")({
        element: host,
        content: {
          type: "doc",
          attrs: { semloEditorDocumentFontFamily: "Delayed A", semloEditorDocumentFontName: "Delayed A" },
          content: [{ type: "paragraph", content: [{ type: "text", text: "abcd" }] }],
        },
      });
      window.raceAliases = [];
      window.startDelayed = () => {
        const alias = document.querySelector<HTMLElement>("#emphasis-race .semlo-editor-prose")!.dataset
          .semloEditorDocumentFace!;
        window.__semloRequireFixture("raceAliases").push(alias);
        document.fonts.load(`16px "${alias}"`).catch(() => {});
      };
      window.__semloRequireFixture("startDelayed")();
    });
    await page.waitForFunction(() =>
      Array.from(document.fonts).some(
        (face) => face.family === window.__semloRequireFixture("raceAliases")[0] && face.status === "loading",
      ),
    );
    await page.evaluate(() => {
      window.__semloRequireFixture("emphasisRace").editor.commands.command(({ tr }) => {
        tr.setDocAttribute("semloEditorDocumentFontFamily", "Delayed B");
        tr.setDocAttribute("semloEditorDocumentFontName", "Delayed B");
        return true;
      });
      window.__semloRequireFixture("startDelayed")();
    });
    await page.waitForFunction(() =>
      Array.from(document.fonts).some(
        (face) => face.family === window.__semloRequireFixture("raceAliases")[1] && face.status === "loading",
      ),
    );
    await page.evaluate(() => {
      window.__semloRequireFixture("emphasisRace").setContent("<p>replaced</p>");
      window.__semloRequireFixture("emphasisRace").editor.commands.command(({ tr }) => {
        tr.setDocAttribute("semloEditorDocumentFontFamily", "Delayed C");
        tr.setDocAttribute("semloEditorDocumentFontName", "Delayed C");
        return true;
      });
      window.__semloRequireFixture("startDelayed")();
      window.__semloRequireFixture("emphasisRace").destroy();
    });
    release();
    await page.waitForTimeout(250);
    const remaining = await page.evaluate(() =>
      window
        .__semloRequireFixture("raceAliases")
        .filter(
          (alias) =>
            Array.from(document.fonts).some((face) => face.family === alias) ||
            Array.from(document.querySelectorAll("style[data-semlo-editor-local-fonts]")).some((style) =>
              style.textContent?.includes(alias),
            ),
        ),
    );
    if (remaining.length || requests.length < 2)
      throw new Error(
        "Late font loads survived font replacement or destruction: " + JSON.stringify({ remaining, requests }),
      );
  } finally {
    release();
    await page.unroute("**/__ink_delayed_font_*");
  }
  await cdp.detach();
  if (errors.length) throw new Error(errors.join("; "));
  return {
    realSyntheticWeightAndStyle: true,
    realNativeBold: true,
    realNativeItalicAndCombined: !!real.richer,
    selectedBoldPreserved: true,
    mixedSelection: true,
    undoRedo: true,
    jsonHtmlRoundtripAndReloadWithoutPermission: true,
    ambiguityAndFallback: true,
    sharedEditorLifecycle: true,
    delayedCleanup: true,
  };
}
