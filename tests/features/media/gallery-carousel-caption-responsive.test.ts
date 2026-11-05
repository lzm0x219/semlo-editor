import { expect, test } from "@rstest/playwright";

test("carousel caption scales with the gallery width", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'gallery-caption-responsive'
      host.style.width = '850px'
      document.body.prepend(host)
      createEditor({element:host,outline:false,content:{type:'doc',content:[
        {type:'semloEditorGallery',attrs:{data:{id:'carousel',layout:'carousel',images:[
          {id:'a',src:'/tests/sample-image.svg',title:'第一张测试图的长标题用于检查文字是否换行省略以及显示范围',href:''},
          {id:'b',src:'/tests/sample-image.svg?b',title:'',href:''}
        ]}}}, {type:'paragraph'}]}})
    `,
  });
  const host = page.locator("#gallery-caption-responsive");
  const stage = host.locator(".semlo-editor-gallery-stage");
  const caption = stage.locator(".semlo-editor-gallery-caption");
  await expect(caption).toContainText("第一张测试图");
  const metrics = () =>
    caption.evaluate((element) => ({
      font: parseFloat(getComputedStyle(element).fontSize),
      padding: parseFloat(getComputedStyle(element).paddingLeft),
    }));
  const wideWidth = (await stage.boundingBox())!.width;
  const wide = await metrics();
  await host.evaluate((element) => ((element as HTMLElement).style.width = "650px"));
  const narrowWidth = (await stage.boundingBox())!.width;
  const narrow = await metrics();
  expect(wideWidth).toBeGreaterThan(narrowWidth);
  expect(wide.font).toBeGreaterThan(narrow.font);
  expect(wide.font).toBeLessThanOrEqual(29);
  expect(narrow.font).toBeGreaterThanOrEqual(16);
  expect(wide.padding / wideWidth).toBeCloseTo(0.032, 2);
  expect(narrow.padding / narrowWidth).toBeCloseTo(0.032, 2);
  const title = caption.locator("span");
  const titleHeight = (await title.boundingBox())!.height;
  expect(titleHeight).toBeGreaterThan(narrow.font * 1.8);
  await expect(caption).toHaveAttribute("data-has-title", "true");
  const titledGradient = await caption.evaluate((element) => getComputedStyle(element).backgroundImage);
  await stage.getByRole("button", { name: "第 2 张图片" }).click();
  await expect(caption).toHaveAttribute("data-has-title", "false");
  const emptyGradient = await caption.evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(emptyGradient).not.toBe(titledGradient);
});
