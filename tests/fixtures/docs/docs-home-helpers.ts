import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

import { test, type Page } from "@rstest/playwright";

type ReducedMotion = "reduce" | "no-preference";

export function useDocsHome(defaultMotion?: ReducedMotion) {
  let server: ChildProcess | undefined;
  let origin = "";

  test.beforeAll(async () => {
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
    const child = spawn(
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
        // 各测试文件独立启动 Rspress，多个进程会争用同一个持久构建缓存。
        env: { ...process.env, RSPRESS_PERSISTENT_CACHE: "false" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    server = child;
    let output = "";
    let startError: Error | undefined;
    const recordOutput = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-4_096);
    };
    child.stdout.on("data", recordOutput);
    child.stderr.on("data", recordOutput);
    child.once("error", (error) => {
      startError = error;
    });
    const signal = AbortSignal.timeout(30_000);
    while (!signal.aborted) {
      if (startError) throw startError;
      const exit = child.exitCode ?? child.signalCode;
      if (exit !== null) throw new Error(`文档测试服务器提前退出：${exit}\n${output}`);
      try {
        if ((await fetch(origin, { signal })).ok) return;
      } catch {
        // 开发服务器尚未就绪。
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`文档测试服务器启动超时\n${output}`);
  });

  test.afterAll(() => {
    server?.kill();
  });

  async function openHome(page: Page, reducedMotion = defaultMotion) {
    // 与动效无关的用例可在导航前请求静态场景，避免持续渲染占用无头浏览器。
    if (reducedMotion) await page.emulateMedia({ reducedMotion });
    await page.goto(origin);
    const editor = page.getByRole("textbox", { name: "首页试用编辑器" });
    await editor.waitFor({ state: "visible" });
    return editor;
  }

  return openHome;
}

export async function chooseExample(page: Page, title: string) {
  await page.getByRole("button", { name: /选择演示内容，当前/ }).click();
  await page.getByRole("menuitem", { name: title }).click();
}

export async function appendText(page: Page, text: string) {
  const paragraph = page.locator(".semlo-editor-editor-host .semlo-editor-prose p").first();
  await paragraph.click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(text);
}
