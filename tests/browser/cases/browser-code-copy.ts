async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  await page.evaluate(async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          window.copied = text;
        },
      },
    });
    const { createEditor } = await import("/dist/index.js");
    const host = document.createElement("div");
    host.id = "copy-test";
    document.body.append(host);
    window.copyApi = createEditor({
      element: host,
      content: { type: "doc", content: [{ type: "codeBlock", content: [{ type: "text", text: "const n = 42" }] }] },
    });
  });
  const copy = page.locator("#copy-test .semlo-editor-code-copy");
  await page.locator("#copy-test .semlo-editor-code-card").hover();
  await copy.click();
  if (
    (await copy.getAttribute("aria-label")) !== "已复制" ||
    (await copy.locator("svg path").getAttribute("d")) !== "M5 12l4 4L19 6" ||
    (await page.evaluate(() => window.__semloRequireFixture("copied"))) !== "const n = 42"
  )
    throw new Error("Copy success feedback incorrect");
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
  await copy.click();
  if (
    (await copy.getAttribute("aria-label")) !== "复制失败" ||
    (await copy.locator("svg path").getAttribute("d")) !== "M6 6l12 12M18 6 6 18"
  )
    throw new Error("Copy failure was not reported");
  await page.evaluate(() => {
    window.__semloRequireFixture("copyApi").destroy();
    document.querySelector("#copy-test")!.remove();
  });
  if (errors.length) throw new Error(errors.join("; "));
  return { success: true, failureFeedback: true };
}
