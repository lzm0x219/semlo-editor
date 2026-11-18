import { appendFileSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

import { test, type Page } from "@rstest/playwright";

function mark(phase: string, start: number) {
  appendFileSync("/tmp/semlo-docs-motion-probe.ndjson", JSON.stringify({
    mode: process.env.SEMLO_DOCS_PROBE_MODE,
    phase,
    ms: Math.round(performance.now() - start),
  }) + "\n");
}

export function useDocsHome() {
  let server: ChildProcess | undefined;
  let origin = "";

  test.beforeAll(async () => {
    const start = performance.now();
    const port = await new Promise<number>((resolve, reject) => {
      const socket = createServer();
      socket.once("error", reject);
      socket.listen(0, "127.0.0.1", () => {
        const address = socket.address();
        if (!address || typeof address === "string") return reject(new Error("无法分配测试端口"));
        socket.close((error) => (error ? reject(error) : resolve(address.port)));
      });
    });
    origin = `http://127.0.0.1:${port}`;
    server = spawn(
      process.execPath,
      [
        "docs/node_modules/@rspress/core/bin/rspress.js",
        "dev",
        "--config",
        "docs/rspress.config.ts",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        cwd: process.cwd(),
        stdio: "ignore",
      },
    );
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (server.exitCode !== null) throw new Error(`文档测试服务器提前退出：${server.exitCode}`);
      try {
        if ((await fetch(origin)).ok) { mark("server", start); return; }
      } catch {
        // 开发服务器尚未就绪。
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("文档测试服务器启动超时");
  });

  test.afterAll(() => {
    server?.kill();
  });

  async function openHome(page: Page, motion = false) {
    if (process.env.SEMLO_DOCS_PROBE_MODE === "reduce" && !motion) {
      await page.emulateMedia({ reducedMotion: "reduce" });
    }
    const navigation = performance.now();
    await page.goto(origin);
    mark("navigation", navigation);
    const ready = performance.now();
    const editor = page.getByRole("textbox", { name: "首页试用编辑器" });
    await editor.waitFor({ state: "visible" });
    mark("editor visible after navigation", ready);
    return editor;
  }

  return openHome;
}

export async function chooseExample(page: Page, title: string) {
  const start = performance.now();
  await page.getByRole("button", { name: /选择演示内容，当前/ }).click();
  await page.getByRole("menuitem", { name: title }).click();
  mark("choose example", start);
}

export async function appendText(page: Page, text: string) {
  const start = performance.now();
  const paragraph = page.locator(".semlo-editor-editor-host .semlo-editor-prose p").first();
  await paragraph.click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(text);
  mark("append text", start);
}
