import { readFile } from "node:fs/promises";

import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("backslash-prefixed pseudo-relative attachment and media URLs are rejected", async ({ page }) => {
  await page.route("**://example.test/**", (route) => route.abort());
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js';
    const host=document.createElement('div');host.id='media-isolated';document.body.append(host);
    const suspect='/' + String.fromCharCode(92) + 'example.test/file';
    window.mediaIsolationEditor=createEditor({element:host,outline:false,content:{type:'doc',content:[
      {type:'paragraph',content:[{type:'semloEditorAttachment',attrs:{href:suspect,name:'file.txt'}}]},
      {type:'semloEditorVideo',attrs:{src:suspect,name:'video.mp4'}},
      {type:'semloEditorAudio',attrs:{src:suspect,name:'audio.wav'}}
    ]}});
  `,
  });
  await page.waitForFunction(() => Boolean(window.mediaIsolationEditor));
  const host = page.locator("#media-isolated");
  await expect(host.locator("a[data-semlo-editor-attachment]")).not.toHaveAttribute("href");
  await expect(host.locator("video")).not.toHaveAttribute("src");
  await expect(host.locator("audio")).not.toHaveAttribute("src");
  const html = await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").getSnapshot().html);
  expect(html).not.toContain("example.test");
  await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").destroy());
});

test("HTML import rejects pseudo-relative attachment and media URLs", async ({ page }) => {
  await page.route("**://example.test/**", (route) => route.abort());
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js';
    const host=document.createElement('div');host.id='media-isolated';document.body.append(host);
    const suspect='/' + String.fromCharCode(92) + 'example.test/file';
    const content='<p><a data-semlo-editor-attachment data-name="file.txt" href="'+suspect+'">file.txt</a></p>'+['video','audio'].map(kind => '<div data-semlo-editor-media="'+kind+'" data-src="'+suspect+'" data-name="'+kind+'"></div>').join('');
    window.mediaIsolationEditor=createEditor({element:host,outline:false,content});
  `,
  });
  await page.waitForFunction(() => Boolean(window.mediaIsolationEditor));
  const host = page.locator("#media-isolated");
  await expect(host.locator("a[data-semlo-editor-attachment]")).not.toHaveAttribute("href");
  await expect(host.locator("video, audio")).toHaveCount(2);
  await expect(host.locator("video")).not.toHaveAttribute("src");
  await expect(host.locator("audio")).not.toHaveAttribute("src");
  const html = await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").getSnapshot().html);
  expect(html).not.toContain("example.test");
  await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").destroy());
});

test("an invalid uploaded attachment URL reports an error and the next queued file succeeds", async ({ page }) => {
  await page.route("**://example.test/**", (route) => route.abort());
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js';
    const host=document.createElement('div');host.id='media-isolated';document.body.append(host);
    window.mediaUploadErrors=[];
    window.mediaIsolationEditor=createEditor({element:host,outline:false,content:'<p>文本</p>',
        uploadAttachment:async file => file.name==='bad.txt' ? '/' + String.fromCharCode(92) + 'example.test/file' : file.name==='badcontrol.txt' ? '/files/' + String.fromCharCode(10) + 'bad' : file.name==='badnull.txt' ? null : file.name==='badnumber.txt' ? 42 : file.name==='badlong.txt' ? '/'+ 'x'.repeat(4096) : '/files/good.txt',
      onError:error => window.mediaUploadErrors.push(error.message)});
  `,
  });
  await page.waitForFunction(() => Boolean(window.mediaIsolationEditor));
  const host = page.locator("#media-isolated");
  await host.locator('input[type="file"][multiple]').setInputFiles([
    { name: "bad.txt", mimeType: "text/plain", buffer: Buffer.from("bad") },
    { name: "badcontrol.txt", mimeType: "text/plain", buffer: Buffer.from("bad") },
    { name: "badnull.txt", mimeType: "text/plain", buffer: Buffer.from("bad") },
    { name: "badnumber.txt", mimeType: "text/plain", buffer: Buffer.from("bad") },
    { name: "badlong.txt", mimeType: "text/plain", buffer: Buffer.from("bad") },
    { name: "good.txt", mimeType: "text/plain", buffer: Buffer.from("good") },
  ]);
  await expect(host.locator("a[data-semlo-editor-attachment]")).toHaveAttribute("href", "/files/good.txt");
  await expect(host.locator("a[data-semlo-editor-attachment]")).toHaveText("good.txt");
  expect(await page.evaluate(() => window.__semloRequireFixture("mediaUploadErrors"))).toEqual([
    "上传成功，但返回的附件地址无效",
    "上传成功，但返回的附件地址无效",
    "上传成功，但返回的附件地址无效",
    "上传成功，但返回的附件地址无效",
    "上传成功，但返回的附件地址无效",
  ]);
  await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").destroy());
});

test("uploaded audio and video reject pseudo-relative URLs and accept valid ones", async ({ page }) => {
  await page.route("**://example.test/**", (route) => route.abort());
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js';
    const host=document.createElement('div');host.id='media-isolated';document.body.append(host);
    window.mediaUploadErrors=[];
    window.mediaIsolationEditor=createEditor({element:host,outline:false,content:'<p>文本</p>',
        uploadAttachment:async file => file.name==='bad.wav' ? null : file.name==='bad.mp4' ? '/'+'x'.repeat(4096) : file.name==='badpath.wav' ? '/' + String.fromCharCode(92) + 'example.test/file' : '/files/'+file.name,
      onError:error => window.mediaUploadErrors.push(error.message)});
  `,
  });
  await page.waitForFunction(() => Boolean(window.mediaIsolationEditor));
  const host = page.locator("#media-isolated");
  const audio = host.locator('input[data-semlo-editor-media-input="audio"]');
  const video = host.locator('input[data-semlo-editor-media-input="video"]');
  await audio.setInputFiles({ name: "bad.wav", mimeType: "audio/wav", buffer: Buffer.from("bad") });
  await video.setInputFiles({ name: "bad.mp4", mimeType: "video/mp4", buffer: Buffer.from("bad") });
  await audio.setInputFiles({ name: "badpath.wav", mimeType: "audio/wav", buffer: Buffer.from("bad") });
  await page.waitForFunction(() => window.mediaUploadErrors?.length === 3);
  await expect(host.locator("audio, video")).toHaveCount(0);
  await audio.setInputFiles({ name: "good.wav", mimeType: "audio/wav", buffer: Buffer.from("good") });
  await video.setInputFiles({ name: "good.mp4", mimeType: "video/mp4", buffer: Buffer.from("good") });
  await expect(host.locator("audio")).toHaveAttribute("src", "/files/good.wav");
  await expect(host.locator("video")).toHaveAttribute("src", "/files/good.mp4");
  await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").destroy());
});

test("valid relative, HTTP, HTTPS and blob attachment and media URLs remain available", async ({ page }) => {
  await page.route("**://example.test/**", (route) => route.abort());
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js';
    const host=document.createElement('div');host.id='media-isolated';document.body.append(host);
      const paths=['/files/local','http://example.test/remote','https://example.test/remote','blob:https://example.test/00000000-0000-0000-0000-000000000000'];
    const content=[];
    for (const src of paths) {
      content.push({type:'paragraph',content:[{type:'semloEditorAttachment',attrs:{href:src,name:'file.txt'}}]});
      content.push({type:'semloEditorVideo',attrs:{src,name:'video.mp4'}});
      content.push({type:'semloEditorAudio',attrs:{src,name:'audio.wav'}});
    }
    window.mediaIsolationEditor=createEditor({element:host,outline:false,content:{type:'doc',content}});
  `,
  });
  await page.waitForFunction(() => Boolean(window.mediaIsolationEditor));
  const links = await page
    .locator("#media-isolated a, #media-isolated video, #media-isolated audio")
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute(element.tagName === "A" ? "href" : "src")),
    );
  expect(links).toEqual([
    "/files/local",
    "/files/local",
    "/files/local",
    "http://example.test/remote",
    "http://example.test/remote",
    "http://example.test/remote",
    "https://example.test/remote",
    "https://example.test/remote",
    "https://example.test/remote",
    "blob:https://example.test/00000000-0000-0000-0000-000000000000",
    "blob:https://example.test/00000000-0000-0000-0000-000000000000",
    "blob:https://example.test/00000000-0000-0000-0000-000000000000",
  ]);
  await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").destroy());
});

test("deleting media tolerates a host that destroys the editor on the deletion transaction", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  await page.route("https://example.test/**", (route) => route.fulfill({ status: 404 }));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js';
    const host=document.createElement('div');host.id='media-isolated';document.body.append(host);
    const api=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'semloEditorVideo',attrs:{src:'https://example.test/video.mp4',name:'video.mp4'}}]}});
    window.mediaIsolationEditor=api;
    api.editor.on('transaction',({transaction}) => { if(transaction.docChanged) api.destroy() });
  `,
  });
  await page.waitForFunction(() => Boolean(window.mediaIsolationEditor));
  await page.locator("#media-isolated").getByRole("button", { name: "删除视频" }).click();
  expect(await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").editor.isDestroyed)).toBe(true);
  expect(errors).toEqual([]);
});

test("reentrant document replacement while adding a multi-file batch starts no uploads", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js';
      const host = document.createElement('div'); host.id = 'media-isolated'; document.body.prepend(host);
      window.mediaUploadErrors = [];
      const api = createEditor({element:host,outline:false,content:'<p>原文</p>',
        uploadAttachment:async file => { window.mediaUploadErrors.push(file.name); return 'https://example.test/'+file.name }});
      window.mediaIsolationEditor = api;
      const key = api.editor.state.plugins.find(plugin => plugin.key.startsWith('semlo-editor-attachment-upload'));
      let replaced = false;
      api.editor.on('transaction', ({transaction}) => {
        if (!replaced && transaction.getMeta(key)?.add) { replaced = true; api.setContent('<p>新文档</p>') }
      });
    `,
  });
  await page.waitForFunction(() => Boolean(window.mediaIsolationEditor));
  await page.locator('#media-isolated input[type="file"][multiple]').setInputFiles([
    { name: "first.txt", mimeType: "text/plain", buffer: Buffer.from("first") },
    { name: "second.txt", mimeType: "text/plain", buffer: Buffer.from("second") },
  ]);
  await expect(page.locator("#media-isolated .tiptap")).toContainText("新文档");
  expect(await page.evaluate(() => window.__semloRequireFixture("mediaUploadErrors"))).toEqual([]);
  await expect(page.locator("#media-isolated .semlo-editor-uploading")).toHaveCount(0);
  await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").destroy());
});

declare global {
  interface Window {
    mediaIsolationEditor?: EditorController;
    mediaUploadErrors?: string[];
    pendingMedia?: Array<{ name: string; resolve: (url: string) => void }>;
  }
}

test("audio and video survive JSON and HTML and support delete, undo and read-only", async ({ page }) => {
  await page.route("https://example.test/**", (route) => route.fulfill({ status: 404 }));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js';
    const host = document.createElement('div'); host.id = 'media-isolated'; document.body.prepend(host);
    window.mediaIsolationEditor = createEditor({element:host,outline:false,content:{type:'doc',content:[
      {type:'paragraph',content:[{type:'text',text:'前文'},{type:'semloEditorAttachment',attrs:{href:'https://example.test/file.txt',name:'file.txt',size:4,mimeType:'text/plain'}}]},
      {type:'semloEditorAudio',attrs:{src:'https://example.test/audio.mp3',name:'audio.mp3',size:10,mimeType:'audio/mpeg'}},
      {type:'semloEditorVideo',attrs:{src:'https://example.test/video.mp4',name:'video.mp4',size:20,mimeType:'video/mp4'}}
    ]}});
  `,
  });
  const host = page.locator("#media-isolated");
  await page.waitForFunction(() => Boolean(window.mediaIsolationEditor));
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").getSnapshot());
  const copiedHTML = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mediaIsolationEditor").editor;
    editor.commands.selectAll();
    return editor.view.serializeForClipboard(editor.state.selection.content()).dom.innerHTML;
  });
  expect(copiedHTML).toContain("data-semlo-editor-attachment");
  expect(copiedHTML).toContain('data-semlo-editor-media="audio"');
  expect(copiedHTML).toContain('data-semlo-editor-media="video"');
  await page.evaluate((html) => {
    const editor = window.__semloRequireFixture("mediaIsolationEditor").editor;
    window.__semloRequireFixture("mediaIsolationEditor").setContent("<p></p>");
    editor.commands.setTextSelection(1);
    const data = new DataTransfer();
    data.setData("text/html", html);
    editor.view.dom.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, copiedHTML);
  await expect(host.locator("a[data-semlo-editor-attachment]")).toHaveCount(1);
  await expect(host.locator("audio")).toHaveAttribute("src", "https://example.test/audio.mp3");
  await expect(host.locator("video")).toHaveAttribute("src", "https://example.test/video.mp4");
  for (const content of [snapshot.html, snapshot.json]) {
    await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").setContent("<p>替换</p>"));
    await page.evaluate((value) => window.__semloRequireFixture("mediaIsolationEditor").setContent(value), content);
    expect(
      (await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").getSnapshot())).json,
    ).toEqual(snapshot.json);
    await expect(host.locator("audio")).toHaveAttribute("src", "https://example.test/audio.mp3");
    await expect(host.locator("video")).toHaveAttribute("src", "https://example.test/video.mp4");
  }
  await host.getByRole("button", { name: "删除视频" }).click();
  await expect(host.locator("video")).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(host.locator("video")).toHaveCount(1);
  await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").setEditable(false));
  await expect(host.getByRole("button", { name: "删除视频", includeHidden: true })).toBeHidden();
  await expect(host.locator("video")).toHaveAttribute("controls", "");
  await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").destroy());
});

test("host upload callback inserts local audio and video and rejects mismatched files", async ({ page }) => {
  await page.route("https://example.test/**", (route) => route.fulfill({ status: 404 }));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js';
      const host = document.createElement('div'); host.id = 'media-isolated'; document.body.prepend(host);
      window.mediaUploadErrors = [];
      window.mediaIsolationEditor = createEditor({element:host,outline:false,content:'<p>开始</p>',
        uploadAttachment:async file => 'https://example.test/'+file.name,
        onError:error => window.mediaUploadErrors.push(error.message)});
    `,
  });
  await page.waitForFunction(() => Boolean(window.mediaIsolationEditor));
  const host = page.locator("#media-isolated");
  const audio = host.locator('input[data-semlo-editor-media-input="audio"]');
  const video = host.locator('input[data-semlo-editor-media-input="video"]');
  await audio.setInputFiles({ name: "voice.wav", mimeType: "audio/wav", buffer: Buffer.from("test") });
  await expect(host.locator("audio")).toHaveAttribute("src", "https://example.test/voice.wav");
  await video.setInputFiles({ name: "movie.mp4", mimeType: "video/mp4", buffer: Buffer.from("test") });
  await expect(host.locator("video")).toHaveAttribute("src", "https://example.test/movie.mp4");
  await video.setInputFiles({ name: "invalid.txt", mimeType: "text/plain", buffer: Buffer.from("test") });
  expect(await page.evaluate(() => window.__semloRequireFixture("mediaUploadErrors"))).toEqual(["请选择视频文件"]);
  await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").destroy());
});

test("media imported from untrusted JSON cannot load or export unsafe URLs", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js';
      const host = document.createElement('div'); host.id = 'media-isolated'; document.body.prepend(host);
      window.mediaIsolationEditor = createEditor({element:host,outline:false,content:{type:'doc',content:[
        {type:'semloEditorVideo',attrs:{src:'javascript:alert(1)',name:'unsafe'}},
        {type:'semloEditorAudio',attrs:{src:'data:text/html,unsafe',name:'unsafe audio'}}
      ]}});
    `,
  });
  const host = page.locator("#media-isolated");
  await page.waitForFunction(() => Boolean(window.mediaIsolationEditor));
  await expect(host.locator("video")).not.toHaveAttribute("src", /.+/);
  await expect(host.locator("audio")).not.toHaveAttribute("src", /.+/);
  const html = (await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").getSnapshot())).html;
  expect(html).not.toContain("javascript:");
  expect(html).not.toContain("data:text/html");
  await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").destroy());
});

test("audio can play real media bytes in the editor", async ({ page }) => {
  const sampleRate = 8000;
  const samples = Buffer.alloc(sampleRate * 2);
  const wav = Buffer.alloc(44);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + samples.length, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples.length, 40);
  await page.route("https://example.test/silence.wav", (route) =>
    route.fulfill({ status: 200, contentType: "audio/wav", body: Buffer.concat([wav, samples]) }),
  );
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js';
      const host = document.createElement('div'); host.id = 'media-isolated'; document.body.prepend(host);
      window.mediaIsolationEditor = createEditor({element:host,outline:false,content:{type:'doc',content:[
        {type:'semloEditorAudio',attrs:{src:'https://example.test/silence.wav',name:'silence.wav',mimeType:'audio/wav'}}
      ]}});
    `,
  });
  const audio = page.locator("#media-isolated audio");
  await page.waitForFunction(() => Boolean(window.mediaIsolationEditor));
  await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").setEditable(false));
  await audio.evaluate((element: HTMLAudioElement) => element.play());
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0);
  expect(await audio.evaluate((element: HTMLAudioElement) => element.duration)).toBe(1);
  await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").destroy());
});

test("video can decode and play real media bytes in the editor", async ({ page }) => {
  const videoBytes = await readFile("tests/fixtures/semlo-editor-blue.mp4");
  await page.route("https://example.test/blue.mp4", (route) =>
    route.fulfill({ status: 200, contentType: "video/mp4", body: videoBytes }),
  );
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js';
      const host = document.createElement('div'); host.id = 'media-isolated'; document.body.prepend(host);
      window.mediaIsolationEditor = createEditor({element:host,outline:false,content:{type:'doc',content:[
        {type:'semloEditorVideo',attrs:{src:'https://example.test/blue.mp4',name:'blue.mp4',mimeType:'video/mp4'}}
      ]}});
    `,
  });
  const video = page.locator("#media-isolated video");
  await page.waitForFunction(() => Boolean(window.mediaIsolationEditor));
  await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").setEditable(false));
  await video.evaluate((element: HTMLVideoElement) => element.play());
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
  expect(await video.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBeGreaterThan(0);
  expect(await video.evaluate((element: HTMLVideoElement) => element.videoHeight)).toBeGreaterThan(0);
  await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").destroy());
});

test("copying table cells preserves an attachment through paste", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js';
      const host=document.createElement('div'); host.id='media-isolated'; document.body.prepend(host);
      window.mediaIsolationEditor=createEditor({element:host,outline:false,content:
        '<table><tbody><tr><td><p><a data-semlo-editor-attachment="" data-name="report.txt" href="https://example.test/report.txt">report.txt</a></p></td><td><p>第二格</p></td></tr></tbody></table>'});
    `,
  });
  await page.waitForFunction(() => Boolean(window.mediaIsolationEditor));
  const copied = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mediaIsolationEditor").editor;
    const positions: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell" || node.type.name === "tableHeader") positions.push(pos);
    });
    editor.commands.setCellSelection({ anchorCell: positions[0], headCell: positions[1] });
    return editor.view.serializeForClipboard(editor.state.selection.content()).dom.innerHTML;
  });
  expect(copied).toContain("data-semlo-editor-attachment");
  await page.evaluate((html) => {
    const controller = window.__semloRequireFixture("mediaIsolationEditor");
    const editor = controller.editor;
    controller.setContent("<p></p>");
    editor.commands.setTextSelection(1);
    const data = new DataTransfer();
    data.setData("text/html", html);
    editor.view.dom.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, copied);
  const attachment = page.locator("#media-isolated a[data-semlo-editor-attachment]");
  await expect(attachment).toHaveAttribute("href", "https://example.test/report.txt");
  await expect(attachment).toHaveText("report.txt");
  await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").destroy());
});

test("two pending video selections at one position both insert", async ({ page }) => {
  await page.route("https://example.test/**", (route) => route.fulfill({ status: 404 }));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js';
      const host=document.createElement('div'); host.id='media-isolated'; document.body.prepend(host);
      window.pendingMedia=[];
      window.mediaIsolationEditor=createEditor({element:host,outline:false,content:'<p></p>',
        uploadAttachment:file=>new Promise(resolve=>window.pendingMedia.push({name:file.name,resolve}))});
    `,
  });
  await page.waitForFunction(() => Boolean(window.mediaIsolationEditor));
  const input = page.locator('#media-isolated input[data-semlo-editor-media-input="video"]');
  await input.setInputFiles({ name: "first.mp4", mimeType: "video/mp4", buffer: Buffer.from("first") });
  await input.setInputFiles({ name: "second.mp4", mimeType: "video/mp4", buffer: Buffer.from("second") });
  await page.waitForFunction(() => window.__semloRequireFixture("pendingMedia").length === 2);
  await page.evaluate(() => window.__semloRequireFixture("pendingMedia")[0].resolve("https://example.test/first.mp4"));
  await expect(page.locator("#media-isolated video")).toHaveCount(1);
  await page.evaluate(() => window.__semloRequireFixture("pendingMedia")[1].resolve("https://example.test/second.mp4"));
  const videos = page.locator("#media-isolated video");
  await expect(videos).toHaveCount(2);
  await expect(videos.nth(0)).toHaveAttribute("src", "https://example.test/first.mp4");
  await expect(videos.nth(1)).toHaveAttribute("src", "https://example.test/second.mp4");
  await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").destroy());
});

test("replacing content or switching to read-only discards pending video uploads", async ({ page }) => {
  await page.route("https://example.test/**", (route) => route.fulfill({ status: 404 }));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js';
      const host=document.createElement('div'); host.id='media-isolated'; document.body.prepend(host);
      window.pendingMedia=[];
      window.mediaIsolationEditor=createEditor({element:host,outline:false,content:'<p></p>',
        uploadAttachment:file=>new Promise(resolve=>window.pendingMedia.push({name:file.name,resolve}))});
    `,
  });
  await page.waitForFunction(() => Boolean(window.mediaIsolationEditor));
  const host = page.locator("#media-isolated");
  const input = host.locator('input[data-semlo-editor-media-input="video"]');
  await input.setInputFiles({ name: "old.mp4", mimeType: "video/mp4", buffer: Buffer.from("old") });
  await page.waitForFunction(() => window.__semloRequireFixture("pendingMedia").length === 1);
  await page.evaluate(() => {
    window.__semloRequireFixture("mediaIsolationEditor").setContent("<p>新文档</p>");
    window.__semloRequireFixture("pendingMedia")[0].resolve("https://example.test/old.mp4");
  });
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  await expect(host.locator(".semlo-editor-uploading")).toHaveCount(0);
  await expect(host.locator("video")).toHaveCount(0);
  await input.setInputFiles({ name: "readonly.mp4", mimeType: "video/mp4", buffer: Buffer.from("readonly") });
  await page.waitForFunction(() => window.__semloRequireFixture("pendingMedia").length === 2);
  await page.evaluate(() => {
    window.__semloRequireFixture("mediaIsolationEditor").setEditable(false);
    window.__semloRequireFixture("pendingMedia")[1].resolve("https://example.test/readonly.mp4");
  });
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  await expect(host.locator(".semlo-editor-uploading")).toHaveCount(0);
  await expect(host.locator("video")).toHaveCount(0);
  expect(
    (await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").getSnapshot())).html,
  ).toContain("新文档");
  await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").destroy());
});

test("concurrent uploads inside a table cell preserve both media and the table", async ({ page }) => {
  await page.route("https://example.test/**", (route) => route.fulfill({ status: 404 }));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js';
      const host=document.createElement('div'); host.id='media-isolated'; document.body.prepend(host);
      window.pendingMedia=[];
      window.mediaIsolationEditor=createEditor({element:host,outline:false,
        content:'<table><tbody><tr><td><p></p></td><td><p>右侧</p></td></tr></tbody></table>',
        uploadAttachment:file=>new Promise(resolve=>window.pendingMedia.push({name:file.name,resolve}))});
    `,
  });
  await page.waitForFunction(() => Boolean(window.mediaIsolationEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mediaIsolationEditor").editor;
    let position = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && !position) position = pos + 1;
    });
    editor.commands.setTextSelection(position);
  });
  const host = page.locator("#media-isolated");
  const input = host.locator('input[data-semlo-editor-media-input="video"]');
  await input.setInputFiles({ name: "first.mp4", mimeType: "video/mp4", buffer: Buffer.from("first") });
  await input.setInputFiles({ name: "second.mp4", mimeType: "video/mp4", buffer: Buffer.from("second") });
  await page.waitForFunction(() => window.__semloRequireFixture("pendingMedia").length === 2);
  await page.evaluate(() => window.__semloRequireFixture("pendingMedia")[0].resolve("https://example.test/first.mp4"));
  await expect(host.locator("video")).toHaveCount(1);
  await page.evaluate(() => window.__semloRequireFixture("pendingMedia")[1].resolve("https://example.test/second.mp4"));
  await expect(host.locator("video")).toHaveCount(2);
  await expect(host.locator("table")).toHaveCount(1);
  await expect(host.locator("td").first().locator("video")).toHaveCount(2);
  await expect(host.locator("td").nth(1)).toContainText("右侧");
  await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").destroy());
});

test("a controlled write of unchanged content keeps a pending video upload", async ({ page }) => {
  await page.route("https://example.test/**", (route) => route.fulfill({ status: 404 }));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import {createEditor} from '/dist/index.js';
      const host=document.createElement('div'); host.id='media-isolated'; document.body.prepend(host);
      window.pendingMedia=[];
      window.mediaIsolationEditor=createEditor({element:host,outline:false,content:'<p></p>',
        uploadAttachment:file=>new Promise(resolve=>window.pendingMedia.push({name:file.name,resolve}))});
    `,
  });
  await page.waitForFunction(() => Boolean(window.mediaIsolationEditor));
  const host = page.locator("#media-isolated");
  await host.locator('input[data-semlo-editor-media-input="video"]').setInputFiles({
    name: "pending.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("video"),
  });
  await page.waitForFunction(() => window.__semloRequireFixture("pendingMedia").length === 1);
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("mediaIsolationEditor");
    controller.setContent(controller.getSnapshot().json);
    window.__semloRequireFixture("pendingMedia")[0].resolve("https://example.test/pending.mp4");
  });
  await expect(host.locator("video")).toHaveAttribute("src", "https://example.test/pending.mp4");
  await page.evaluate(() => window.__semloRequireFixture("mediaIsolationEditor").destroy());
});
