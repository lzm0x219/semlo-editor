import type { Locator } from "playwright";

/** 字体入口固定在所属编辑器的“更多”面板中。 */
export async function fontToolbarControl(host: Locator): Promise<Locator> {
  const more = host.getByRole("toolbar", { name: "文本格式" }).getByRole("button", { name: "更多", exact: true });
  const id = await more.getAttribute("aria-controls");
  if (!id) throw new Error("工具栏缺少更多面板标识");
  return host.page().locator(`[id="${id}"]`).getByRole("button", { name: "字体", exact: true, includeHidden: true });
}

export async function revealFontToolbar(host: Locator, keyboard = false): Promise<Locator> {
  const more = host.getByRole("toolbar", { name: "文本格式" }).getByRole("button", { name: "更多", exact: true });
  if ((await more.getAttribute("aria-expanded")) !== "true") {
    if (keyboard) {
      await more.focus();
      await more.press("Enter");
    } else await more.click();
  }
  return fontToolbarControl(host);
}

export async function openFontToolbar(host: Locator): Promise<void> {
  await (await revealFontToolbar(host)).click();
}

export const fontToolbar = { control: fontToolbarControl, reveal: revealFontToolbar, open: openFontToolbar };
export type FontToolbarTools = typeof fontToolbar;
