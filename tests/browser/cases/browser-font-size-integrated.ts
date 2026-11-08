async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  await page.evaluate(async () => {
    const { createEditor } = await import("/dist/index.js");
    const host = document.createElement("div");
    host.id = "size-integrated";
    document.body.prepend(host);
    window.integratedSize = createEditor({ element: host, content: "<p>字号测试</p>" });
    window.__semloRequireFixture("integratedSize").editor.commands.focus();
    window.__semloRequireFixture("integratedSize").editor.commands.setTextSelection({ from: 1, to: 5 });
  });
  await page.keyboard.press("ControlOrMeta+Alt+-");
  let json = await page.evaluate(() => window.__semloRequireFixture("integratedSize").getSnapshot().json);
  if (json.content?.[0]?.content?.[0]?.marks?.find((mark) => mark.type === "textStyle")?.attrs?.fontSize !== "14px")
    throw new Error("The integrated editor did not register the font-size shortcut");
  await page.keyboard.press("ControlOrMeta+Alt+Shift+=");
  json = await page.evaluate(() => window.__semloRequireFixture("integratedSize").getSnapshot().json);
  if (json.content?.[0]?.content?.[0]?.marks?.find((mark) => mark.type === "textStyle")?.attrs?.fontSize !== "15px")
    throw new Error("The integrated editor did not restore the next font-size step");
  await page.evaluate(() => window.__semloRequireFixture("integratedSize").destroy());
  if (errors.length) throw new Error(errors.join("; "));
  return { integrated: true, selection: true, steps: true };
}
