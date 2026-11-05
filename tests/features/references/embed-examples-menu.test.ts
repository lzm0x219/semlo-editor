import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    embedExampleEditor?: EditorController;
  }
}

const cases = [
  { id: "bilibili", label: "哔哩哔哩", src: "https://player.bilibili.com/player.html?aid=55895675&autoplay=0" },
  { id: "codepen", label: "CodePen", src: "https://codepen.io/Mamboleoo/embed/XWJPxpZ" },
  { id: "figma", label: "Figma", src: "https://embed.figma.com/design/nrPSsILSYjesyc5UHjYYa4?embed-host=semlo" },
  {
    id: "netease",
    label: "网易云音乐",
    src: "https://music.163.com/outchain/player?type=2&id=1420830402&auto=0&height=66",
  },
  { id: "youku", label: "优酷", src: "https://player.youku.com/embed/XNDc1NDU1MTQwOA==" },
  { id: "canva", label: "Canva", src: "https://www.canva.cn/design/DAD3c63mhHU/view?embed" },
  { id: "processon", label: "ProcessOn", src: "https://www.processon.com/embed/5d006c43e4b071ad5a206ed2" },
  { id: "juejin", label: "码上掘金", src: "https://code.juejin.cn/pen/7111233570496053255?embed=true" },
  {
    id: "modao",
    label: "墨刀",
    src: "https://free.modao.cc/app/2cd26580a6717a147454df7470e7ec464093cba3/embed/v2#screen=sk71k6d1dfxulzx",
  },
  { id: "amap", label: "高德地图", src: "https://ditu.amap.com/" },
  { id: "yida", label: "宜搭", src: "https://www.aliwork.com/o/customer_cases" },
] as const;

for (const item of cases) {
  test(`${item.label} menu opens the example and restores the input on undo`, async ({ page }) => {
    await page.route("https://**", (route) => route.fulfill({ status: 200, body: "Fixture" }));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
      import {createEditor} from '/dist/index.js';
      const host = document.createElement('div'); host.id = 'embed-example'; document.body.prepend(host);
      window.embedExampleEditor = createEditor({element:host,outline:false,content:'<p>正文</p>'});
    `,
    });
    const host = page.locator("#embed-example");
    await host.locator(".semlo-editor-prose p").click();
    await host.getByRole("button", { name: "插入内容" }).click();
    const panel = page.getByRole("dialog", { name: "插入内容" });
    await panel.getByLabel("搜索插入内容").fill(item.label);
    await panel.locator(`[data-command="${item.id}"]`).click();
    await expect(host.getByLabel(`${item.label}链接`)).toBeFocused();
    await host.getByRole("button", { name: "查看示例" }).click();
    await expect(host.locator("iframe")).toHaveAttribute("src", item.src);
    expect(await page.evaluate(() => window.__semloRequireFixture("embedExampleEditor").editor.commands.undo())).toBe(
      true,
    );
    await expect(host.locator("iframe")).toHaveCount(0);
    await expect(host.getByLabel(`${item.label}链接`)).toBeVisible();
    await page.evaluate(() => window.__semloRequireFixture("embedExampleEditor").destroy());
  });
}
