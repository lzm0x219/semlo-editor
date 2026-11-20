import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

import type { RequestHandler } from "@rsbuild/core";
import type { Browser, Locator, Page } from "playwright";

import type {} from "../../fixtures/browser/long-writing-host-fixture.ts";
import { longWritingArticle, longWritingCode } from "../../fixtures/text/long-writing-article.ts";

export function longWritingStorage(file: string): RequestHandler {
  return async (request, response, next) => {
    if (request.url !== "/long-writing-content") return next();
    response.setHeader("Cache-Control", "no-store");
    try {
      if (request.method === "GET") {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(await readFile(file));
      } else if (request.method === "PUT") {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk);
        await writeFile(file, Buffer.concat(chunks));
        response.writeHead(204).end();
      } else {
        response.writeHead(405).end();
      }
    } catch (error) {
      next(error);
    }
  };
}

const snapshot = (page: Page) => page.evaluate(() => window.semloHostArticle!.getSnapshot());

async function append(page: Page, paragraph: Locator, text: string) {
  await paragraph.tap();
  await paragraph.evaluate((node) => document.getSelection()!.collapse(node, node.childNodes.length));
  await page.keyboard.insertText(text);
}

async function save(page: Page, file: string) {
  const saved = await snapshot(page);
  await page.getByRole("button", { name: "保存", exact: true }).tap();
  await page.getByText("已保存", { exact: true }).waitFor();
  assert.equal(await readFile(file, "utf8"), saved.html);
  return saved;
}

export async function checkMobileLongWriting(browser: Browser, origin: string, file: string) {
  await writeFile(file, longWritingArticle, "utf8");
  const options = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true };
  const errors: string[] = [];
  let context = await browser.newContext(options);
  async function open() {
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/?long-writing`);
    await page.waitForFunction(() => Boolean(window.semloHostArticle));
    return page;
  }

  try {
    const page = await open();
    assert.equal(await page.evaluate(() => window.innerWidth), 375);
    const prose = page.locator(".semlo-editor-prose");
    assert.equal(await prose.locator(":scope > h2").count(), 10);
    const cell = prose.locator("td p").filter({ hasText: "待核对" });
    await append(page, cell, "，已更新");
    await prose.getByText("待核对，已更新", { exact: true }).waitFor();
    await page.getByRole("button", { name: "撤销", exact: true }).tap();
    await prose.getByText("待核对", { exact: true }).waitFor();
    await page.getByRole("button", { name: "重做", exact: true }).tap();
    await prose.getByText("待核对，已更新", { exact: true }).waitFor();
    const heading = "第5节 项目交接";
    await page.getByRole("button", { name: `折叠标题：${heading}` }).tap();
    await page.getByRole("button", { name: `展开标题：${heading}` }).waitFor();
    const saved = await save(page, file);
    await context.close();

    context = await browser.newContext(options);
    const reopened = await open();
    assert.deepEqual(await snapshot(reopened), saved);
    const nextProse = reopened.locator(".semlo-editor-prose");
    await reopened.getByRole("button", { name: `展开标题：${heading}` }).waitFor();
    assert.deepEqual(await nextProse.locator("ol li").allTextContents(), ["校对引文", "整理附表"]);
    assert.equal(await nextProse.locator("pre code").textContent(), longWritingCode);
    await append(reopened, nextProse.locator(":scope > p").filter({ hasText: "收尾说明" }), "，继续编辑");
    await nextProse.getByText("收尾说明，继续编辑", { exact: true }).waitFor();
    const continued = await save(reopened, file);
    await reopened.reload();
    await reopened.waitForFunction(() => Boolean(window.semloHostArticle));
    assert.deepEqual(await snapshot(reopened), continued);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}
