async function _browserTest(page: import("playwright").Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/", page.url()).href);
  await page.evaluate(() => {
    const click = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (this.type === "file") {
        window.selectedFileInput = this;
        return;
      }
      click.call(this);
    };
  });
  const upload = async (command: string, filename: string, mimeType: string) => {
    await page.locator(".semlo-editor-prose > p").last().click();
    await page.getByRole("button", { name: "插入内容" }).click();
    const dialog = page.getByRole("dialog", { name: "插入内容" });
    await dialog.getByLabel("搜索插入内容").fill(command);
    await dialog.getByRole("option", { name: new RegExp(command) }).click();
    const selector =
      command === "本地文件"
        ? 'input[type="file"][multiple]'
        : `input[data-semlo-editor-media-input="${command === "本地视频" ? "video" : "audio"}"]`;
    if (!(await page.locator(selector).evaluate((el) => el === window.selectedFileInput)))
      throw new Error(`${command}: wrong file input`);
    const response = await page.request.get(new URL(`/tests/${filename}`, page.url()).href);
    await page.locator(selector).setInputFiles({ name: filename, mimeType, buffer: await response.body() });
  };
  await upload("本地视频", "sample-video.mp4", "video/mp4");
  const video = page.locator(".semlo-editor-media-node video");
  await video.waitFor();
  await video.evaluate((el) => {
    (el as HTMLMediaElement).muted = true;
    return (el as HTMLMediaElement).play();
  });
  await page.waitForFunction(
    () => (document.querySelector<HTMLVideoElement>(".semlo-editor-media-node video")?.currentTime ?? 0) > 0.1,
  );
  await upload("本地音频", "sample-audio.wav", "audio/wav");
  const audio = page.locator(".semlo-editor-media-node audio");
  await audio.waitFor({ state: "attached" });
  await audio.evaluate((el) => {
    (el as HTMLMediaElement).muted = true;
    return (el as HTMLMediaElement).play();
  });
  await page.waitForFunction(
    () => (document.querySelector<HTMLAudioElement>(".semlo-editor-media-node audio")?.currentTime ?? 0) > 0.1,
  );
  await upload("本地文件", "sample-attachment.txt", "text/plain");
  if (!(await page.locator(".semlo-editor-attachment").getByText("sample-attachment.txt").count()))
    throw new Error("Local file did not insert an attachment");
  for (const framework of ["React", "SolidJS", "Vue"]) {
    await page.getByRole("button", { name: framework, exact: true }).click();
    if (!(await video.count()) || !(await audio.count()) || !(await page.locator(".semlo-editor-attachment").count()))
      throw new Error(`${framework}: media lost`);
  }
  const roundtrip = await page.evaluate(async () => {
    const { createEditor } = await import("/dist/index.js");
    const host = document.createElement("div");
    document.body.prepend(host);
    const seed = {
      type: "doc",
      content: [
        {
          type: "semloEditorVideo",
          attrs: { src: "https://example.com/a.mp4", name: "a.mp4", size: 12, mimeType: "video/mp4" },
        },
        {
          type: "semloEditorAudio",
          attrs: { src: "https://example.com/b.wav", name: "b.wav", size: 34, mimeType: "audio/wav" },
        },
      ],
    };
    const api = createEditor({ element: host, content: seed });
    const snapshot = api.getSnapshot();
    if (!snapshot.text.includes("a.mp4") || !snapshot.text.includes("b.wav")) throw new Error("Media text missing");
    api.setContent("<p>reset</p>");
    api.setContent(snapshot.html);
    const nodes = api.getSnapshot().json.content!;
    const result =
      nodes[0]?.type === "semloEditorVideo" &&
      nodes[0].attrs!.src === "https://example.com/a.mp4" &&
      nodes[1]?.type === "semloEditorAudio" &&
      nodes[1].attrs!.name === "b.wav";
    api.setContent('<div data-semlo-editor-media="video" data-src="javascript:alert(1)"></div>');
    const unsafe = host.querySelector("video")?.getAttribute("src");
    api.destroy();
    host.remove();
    return result && !unsafe;
  });
  if (!roundtrip) throw new Error("Media HTML roundtrip or URL validation failed");
  await page.getByRole("button", { name: "只读预览" }).click();
  await video.hover();
  if (await page.getByRole("button", { name: "删除视频" }).count()) throw new Error("Read-only delete is visible");
  await video.evaluate((element) => {
    const player = element as HTMLVideoElement;
    player.currentTime = 0;
    player.muted = true;
    return player.play();
  });
  const pause = page.getByRole("button", { name: "暂停视频" });
  await pause.click();
  await page.waitForFunction(() => document.querySelector<HTMLVideoElement>(".semlo-editor-media-node video")?.paused);
  await page.getByRole("button", { name: "播放视频" }).click();
  await page.waitForFunction(() => !document.querySelector<HTMLVideoElement>(".semlo-editor-media-node video")?.paused);
  await page.getByRole("button", { name: "继续编辑" }).click();
  await video.hover();
  await page.getByRole("button", { name: "删除视频" }).click();
  if (await video.count()) throw new Error("Video deletion failed");
  await page.keyboard.press("ControlOrMeta+z");
  if (!(await video.count())) throw new Error("Video undo failed");
  if (errors.length) throw new Error(errors.join("; "));
  return {
    file: true,
    videoPlayback: true,
    audioPlayback: true,
    frameworks: ["React", "SolidJS", "Vue"],
    htmlAndText: true,
    readOnly: true,
    deleteUndo: true,
  };
}
