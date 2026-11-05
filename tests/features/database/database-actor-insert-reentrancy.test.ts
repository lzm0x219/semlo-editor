import { expect, test } from "@rstest/playwright";

import { createDatabaseData } from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    databaseActorInsertEditor?: EditorController;
    databaseActorInsertMode?: string;
  }
}

for (const mode of ["replace", "replace-new", "readonly", "destroy", "echo"] as const) {
  test(`${mode}: inserting a database respects a synchronous currentUser host callback`, async ({ page }) => {
    await installFixtureGuards(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.evaluate((data) => Reflect.set(window, "databaseActorInsertData", data), createDatabaseData());
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor } from '/dist/index.js'
      const host=document.createElement('div');host.id='database-actor-insert';document.body.prepend(host)
      let controller
      controller=createEditor({element:host,outline:false,content:'<p>原内容</p>',currentUser:()=>{
        const mode=window.databaseActorInsertMode
        if(mode){window.databaseActorInsertMode=undefined
          if(mode==='destroy') controller.destroy()
          else if(mode==='readonly') controller.setEditable(false)
          else if(mode==='echo') controller.setContent(structuredClone(controller.getSnapshot().json))
          else {controller.setContent('<p>新内容</p>');if(mode==='replace-new') controller.editor.commands.insertContent({type:'semloEditorDatabase',attrs:{data:window.databaseActorInsertData}})}
        }
        return {id:'user',label:'用户'}
      }})
      window.databaseActorInsertEditor=controller
    `,
    });
    const host = page.locator("#database-actor-insert");
    await host.locator(".semlo-editor-prose p").click();
    await host.getByRole("button", { name: "插入内容" }).click();
    const menu = page.getByRole("dialog", { name: "插入内容" });
    await menu.getByLabel("搜索插入内容").fill("数据表");
    await page.evaluate((value) => {
      window.databaseActorInsertMode = value;
    }, mode);
    await menu.locator('[data-command="database"]').click();
    if (mode === "destroy") await expect(host.locator(".semlo-editor")).toHaveCount(0);
    else {
      await expect(host.locator(".semlo-editor-database")).toHaveCount(
        mode === "echo" || mode === "replace-new" ? 1 : 0,
      );
      if (mode === "replace" || mode === "replace-new")
        await expect(host.locator(".semlo-editor-prose")).toContainText("新内容");
    }
    expect(errors).toEqual([]);
  });
}
