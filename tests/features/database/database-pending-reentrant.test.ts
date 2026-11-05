import { expect, test } from "@rstest/playwright";

import { createDatabaseData } from "../../../packages/core/src/features/database/model";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
for (const mode of ["echo", "replace", "readonly", "destroy"] as const)
  test(`pending group onChange ${mode}`, async ({ page }) => {
    await installFixtureGuards(page);
    const data = createDatabaseData();
    const field = data.fields[1];
    field.type = "multiSelect";
    field.options = [{ id: "a", label: "甲", color: 0 }];
    field.defaultValue = ["a"];
    data.records.forEach((r) => (r.values[field.id] = []));
    data.views[0].groupFieldId = field.id;
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.evaluate((value) => Reflect.set(window, "pendingData", value), data);
    await page.addScriptTag({
      type: "module",
      content: `import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='pending-reentrant';document.body.prepend(host);let controller;controller=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'semloEditorDatabase',attrs:{data:window.pendingData}},{type:'paragraph'}]},onChange:snapshot=>{const mode=window.pendingMode;if(!mode)return;window.pendingMode='';if(mode==='echo')controller.setContent(structuredClone(snapshot.json));if(mode==='replace'){const next=structuredClone(snapshot.json);next.content[0].attrs.data.records[0].values[next.content[0].attrs.data.fields[0].id]='新内容';controller.setContent(next)}if(mode==='readonly')controller.setEditable(false);if(mode==='destroy')controller.destroy()}});window.pendingEditor=controller`,
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const root = page.locator("#pending-reentrant .semlo-editor-database");
    await page.evaluate((v) => Reflect.set(window, "pendingMode", v), mode);
    await root.getByRole("button", { name: "在（空）分组添加记录" }).click();
    if (mode === "destroy") await expect(root).toHaveCount(0);
    else {
      const snapshot = await page.evaluate(() => Reflect.get(window, "pendingEditor").getSnapshot().json);
      expect(snapshot.content[0].attrs.data.records).toHaveLength(4);
      if (mode === "replace")
        expect(snapshot.content[0].attrs.data.records[0].values[data.fields[0].id]).toBe("新内容");
      const id = snapshot.content[0].attrs.data.records.at(-1).id;
      const group = await page.evaluate((id) => {
        let row = document.querySelector<HTMLElement>(
          `#pending-reentrant .semlo-editor-database-cell[data-record-id="${id}"]`,
        )?.parentElement?.previousElementSibling;
        while (row && !row.classList.contains("semlo-editor-database-group-row")) row = row.previousElementSibling;
        return row?.querySelector(".semlo-editor-database-group-heading")?.getAttribute("aria-label");
      }, id);
      expect(group).toBe(mode === "replace" ? "折叠分组 甲" : "折叠分组 （空）");
      if (mode === "readonly") await expect(root.getByLabel("第 1 行 文本")).toHaveAttribute("readonly", "");
    }
    expect(errors).toEqual([]);
  });
