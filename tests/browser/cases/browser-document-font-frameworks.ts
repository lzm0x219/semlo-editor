async function _browserTest(
  page: import("playwright").Page,
  fonts: import("../../fixtures/browser/font-toolbar").FontToolbarTools,
) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.fontEnumerationCount = 0;
    Object.defineProperty(window, "queryLocalFonts", {
      configurable: true,
      value: () => {
        window.__semloIncrementFixture("fontEnumerationCount");
        return Promise.resolve([{ family: "Semlo Editor Test Font", fullName: "测试字体", style: "Regular" }]);
      },
    });
  });
  const origin = new URL(page.url()).origin;
  await page.goto(origin + "/");
  const demo = page.locator("#editor-host");
  const menu = page.getByRole("dialog", { name: "选择字体" });
  const assertCollapsed = async (host: import("playwright").Locator, label: string) => {
    const collapsed = await host.locator(".semlo-editor-prose").evaluate((root) => {
      const selection = root.ownerDocument.getSelection();
      return !!selection?.isCollapsed && !!selection.anchorNode && root.contains(selection.anchorNode);
    });
    if (!collapsed) throw new Error(label + ": expected a collapsed cursor inside the editor");
  };
  const choose = async (host: import("playwright").Locator) => {
    await assertCollapsed(host, "Before applying document font");
    await fonts.open(host);
    if (await menu.getByRole("radio").count()) throw new Error("Font menu still exposes a scope selector");
    await menu.getByRole("option", { name: "测试字体", exact: true }).click();
    await page.waitForFunction(
      (element) =>
        element.querySelector<HTMLElement>(".semlo-editor-prose")?.style.fontFamily.includes("Semlo Editor Test Font"),
      await host.elementHandle(),
    );
  };
  const assertFont = async (host: import("playwright").Locator, label: string) => {
    const details = await host.locator(".semlo-editor-prose").evaluate((root) => ({
      inline: root.style.fontFamily,
      computed: getComputedStyle(root).fontFamily,
      paragraph: getComputedStyle(root.querySelector("p")!).fontFamily,
      active: root.dataset.semloEditorDocumentFontActive,
      label:
        root.ownerDocument
          .getElementById(
            root.closest(".semlo-editor")!.querySelector(".semlo-editor-toolbar-more")!.getAttribute("aria-controls")!,
          )
          ?.querySelector(".semlo-editor-font-family")?.textContent ?? "",
    }));
    if (
      !details.inline.includes("Semlo Editor Test Font") ||
      !details.computed.includes("Semlo Editor Test Font") ||
      !details.paragraph.includes("Semlo Editor Test Font") ||
      details.active !== "true" ||
      !details.label.includes("测试字体")
    )
      throw new Error(label + ": document font did not survive: " + JSON.stringify(details));
  };
  await demo.locator(".semlo-editor-prose > p").first().click();
  await choose(demo);
  await page.waitForFunction(() => document.activeElement?.matches("#editor-host .semlo-editor-prose"));
  await page.keyboard.type("FontSwitchMarker");
  await assertFont(demo, "Vue before switch");
  for (const framework of ["React", "SolidJS", "Vue"]) {
    await page.getByRole("button", { name: framework, exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector("#editor-host .semlo-editor-prose")?.textContent?.includes("FontSwitchMarker"),
    );
    await assertFont(demo, framework + " after switch");
  }
  if ((await page.evaluate(() => window.__semloRequireFixture("fontEnumerationCount"))) !== 1)
    throw new Error("Framework switch unexpectedly reread fonts");
  await page.goto(origin + "/tests/controlled.html");
  for (const framework of ["react", "vue", "solid"]) {
    const host = page.locator("#" + framework),
      paragraph = host.locator(".semlo-editor-column p").first();
    await paragraph.click();
    await page.keyboard.type("before");
    await choose(host);
    await page.waitForFunction((id) => document.activeElement?.matches("#" + id + " .semlo-editor-prose"), framework);
    await page.keyboard.type("after");
    await page.waitForFunction(
      (id) => document.querySelector("#" + id + " .semlo-editor-column p")?.textContent?.includes("beforeafter"),
      framework,
    );
    await assertFont(host, framework + " after controlled update");
    await assertCollapsed(host, framework + " before resetting document font");
    await fonts.open(host);
    if (await menu.getByRole("radio").count())
      throw new Error(framework + ": font menu still exposes a scope selector");
    await menu.getByRole("option", { name: "默认字体", exact: true }).click();
    await page.waitForFunction((id) => {
      const root = document.querySelector<HTMLElement>("#" + id + " .semlo-editor-prose");
      return root && !root.style.fontFamily && !root.hasAttribute("data-semlo-editor-document-font-active");
    }, framework);
    await page.waitForFunction((id) => document.activeElement?.matches("#" + id + " .semlo-editor-prose"), framework);
    await page.keyboard.type("reset");
    await page.waitForFunction(
      (id) => document.querySelector("#" + id + " .semlo-editor-column p")?.textContent?.includes("beforeafterreset"),
      framework,
    );
    const reset = await host.locator(".semlo-editor-prose").evaluate((root) => ({
      inline: root.style.fontFamily,
      computed: getComputedStyle(root).fontFamily,
      active: root.dataset.semloEditorDocumentFontActive,
      label:
        root.ownerDocument
          .getElementById(
            root.closest(".semlo-editor")!.querySelector(".semlo-editor-toolbar-more")!.getAttribute("aria-controls")!,
          )
          ?.querySelector(".semlo-editor-font-family")?.textContent ?? "",
    }));
    if (
      reset.inline ||
      reset.active ||
      reset.computed.includes("Semlo Editor Test Font") ||
      reset.label.includes("测试字体")
    )
      throw new Error(framework + ": default font did not survive controlled update: " + JSON.stringify(reset));
  }
  if ((await page.evaluate(() => window.__semloRequireFixture("fontEnumerationCount"))) !== 1)
    throw new Error("Controlled framework instances did not share font cache");
  if (errors.length) throw new Error(errors.join("; "));
  return {
    frameworkSwitch: ["Vue", "React", "SolidJS", "Vue"],
    controlled: ["react", "vue", "solid"],
    computedFont: true,
    contentPreserved: true,
    defaultReset: true,
    sharedCache: true,
  };
}
