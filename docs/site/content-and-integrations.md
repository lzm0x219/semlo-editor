---
title: 内容与集成
description: 保存和恢复文档，并接入上传、提及搜索及字体功能。
---

# 内容与集成

## 内容保存与恢复

`content` 支持 ProseMirror JSON 或 HTML 字符串。推荐保存变更事件中的 `json`，恢复时通过 `content` 或控制器的 `setContent()` 传回。`getSnapshot()` 同时提供 JSON、HTML 和纯文本：

```ts
const { json, html, text } = editor.getSnapshot();
// 将 json 保存到应用自己的存储；需要时再恢复。
editor.setContent(json);
```

程序调用 `setContent()` 不会触发 `onChange`。框架适配器会接收外部内容变更；即使默认属性被省略，语义相同的文档也不会被重复替换。切换到另一篇文档时建议重新挂载，以隔离撤销历史。

整篇字体保存在文档根属性中；持久化和恢复请使用控制器的 `getSnapshot().json` / `getSnapshot().html` 与 `setContent()`。直接调用底层 Tiptap 的 `editor.getHTML()` 或 `editor.commands.setContent()` 不会处理 HTML 的文档级字体包装信息。

公式导出的 HTML 保存 TeX 源码和标记，重新载入编辑器时渲染；单独展示该 HTML 时需由接入方渲染公式。输出 HTML 用于不可信内容的展示时，应在服务端或展示端按应用的安全策略处理。

## 图片与附件上传

`uploadImage` 和 `uploadAttachment` 接收 `File` 与可选的上下文，并返回可访问的地址；编辑器调用时会提供 `{ signal }`，只接收文件的旧回调及直接调用仍可使用。后者同时用于附件、本地视频和本地音频。上传服务由接入方提供。

下面的示例假设应用提供两个上传接口，成功后都返回形如 `{ "url": "https://example.com/file" }` 的 JSON：

```ts
import type { AttachmentUpload, ImageUpload } from "@semlo-editor/core";

async function uploadFile(endpoint: string, file: File, signal?: AbortSignal): Promise<string> {
  const data = new FormData();
  data.append("file", file);
  const response = await fetch(endpoint, { method: "POST", body: data, signal });
  if (!response.ok) throw new Error("上传失败");
  const result: { url: string } = await response.json();
  return result.url;
}

const uploadImage: ImageUpload = (file, context) => uploadFile("/api/images", file, context?.signal);
const uploadAttachment: AttachmentUpload = (file, context) => uploadFile("/api/attachments", file, context?.signal);
```

将这两个函数传入 `createEditor()` 或框架组件的同名属性。接口路径和响应格式需要与你的服务保持一致。

上传期间会显示占位，位置会随编辑映射。替换文档、销毁编辑器、切换只读或上传会话失效时，旧结果不会写入新文档，并会中止对应的 `signal`；回调须使用该信号才能取消自身网络请求。保存文档前，应确保返回的地址在后续访问时仍有效。

附件可通过同步的 `resolveAttachmentPreview` 接入应用阅读页，在独立页面预览；未配置时使用安全的原地址。阅读地址不改变文档中的原文件地址，下载仍使用原文件。接口、动态替换及失败规则见[附件预览](/uploads-and-mentions#附件预览)。

## 提及搜索

`searchMentions(query, signal)` 返回人物或文档数组，元素包含 `id`、`label`、`kind`（`'person'` 或 `'document'`）和可选的 `href`。查询变化或菜单关闭时，旧请求的 `signal` 会被中止；网络请求需由回调自行使用该信号。未配置搜索时不会显示真实人物或文档。

例如，假设服务端返回符合 `MentionItem[]` 结构的 JSON：

```ts
import type { MentionSearch } from "@semlo-editor/core";

const searchMentions: MentionSearch = async (query, signal) => {
  const response = await fetch(`/api/mentions?q=${encodeURIComponent(query)}`, { signal });
  if (!response.ok) throw new Error("提及搜索失败");
  return await response.json();
};
```

将 `searchMentions` 传入 `createEditor()` 或框架组件的同名属性。服务端应按应用的权限规则过滤搜索结果。

控制器的 `setIntegrations()` 会整体替换集成选项，未传入的项会被清除；已有上传继续使用启动时的回调，提及搜索在提供方变化时会中止旧请求并刷新。例如，以下调用保留前面定义的三个函数，并清除其他集成选项：

```ts
editor.setIntegrations({ uploadImage, uploadAttachment, searchMentions });
```

若只传入 `searchMentions`，两个上传回调和其他未传入的集成选项都会被清除。

## 写作服务

应用可通过 `writingService` 提供生成服务，通过可选的 `writingFeedback` 接收用户对草稿的反馈。生成请求包含提问、选区副本、有限的前后文与中止信号；结果可以是纯文本或符合当前 schema 的文档 JSON。默认面板先预览，明确接纳后才写入正文；正文、视图、服务或可编辑状态变化后，旧目标不再回写。三个框架均支持同名属性的动态更新，完整示例见[智能写作助手](/writing-assistant)。

## 数据表智能填写

`databaseAiFill` 是独立于 `writingService` 的宿主回调。用户在文本列中配置规则并主动点击“开始自动填写”或“重新填写本列内容”后，回调接收表格标识、目标列及规则、所有列的标识、类型和选项，以及所有记录的值。选项包含显示名称和可能存在的外部人员标识；记录可含文件地址等内容。应用需自行处理访问权限、模型、传输和费用，并决定如何解释“内容总结”和自定义规则；编辑器本身不连接模型。

```ts
import type { DatabaseAiFillService } from "@semlo-editor/core";

const databaseAiFill: DatabaseAiFillService = async ({ signal, ...data }) => {
  const response = await fetch("/api/database-fill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal,
  });
  if (!response.ok) throw new Error("填写失败");
  return await response.json(); // 每条记录返回 { recordId, value: string }
};
```

将回调传入 `createEditor()` 或 React、Vue、SolidJS 组件的同名属性，也可用 `setIntegrations()` 替换。返回结果必须覆盖请求中的每条记录且不重复，每个文本值不超过 10,000 个 UTF-16 代码单元。有效结果一次性写入目标列，支持撤销；错误结果和服务失败保留原值并通过 `onError`（Vue 为 `error`）报告。表格内容或编辑状态变化、服务更换、实例销毁和再次开始填写会中止旧信号并丢弃旧结果；服务需自行使用 `signal` 才能取消网络请求。规则随文档 JSON / HTML 保存，重新加载不会自动发起请求；旧版本的严格数据表读取器可能拒绝包含新规则的内容。

## 字体与界面状态

工具栏“更多”中的“字体”在支持 Local Font Access API 的浏览器中打开时自动读取设备字体，首次使用可能需要授权；读取结果仅缓存在当前页面，安装新字体后可点击搜索框旁的刷新图标。列表展示系统提供的完整字体名称，可按名称、字体族和 PostScript 名搜索；再次打开时会定位到当前勾选的字体。选中文字时修改选区；没有选中文字时修改整篇文档。整篇设置会清除原有的局部字体覆盖，同时保留其他文字格式；字体名随 JSON 和 HTML 保存，但字体文件不会嵌入或上传，其他设备缺少该字体时会回退显示。

对能明确匹配的同字体族常规、粗体、斜体和粗斜体，编辑器优先使用系统已有字形；缺少对应字形时允许浏览器合成粗体或斜体。合成效果依赖浏览器和字体，并非字体设计者绘制的字形。字体映射会随 JSON / HTML 保存，重新载入时无需再次枚举本机字体。HTML 脱离编辑器单独展示时由浏览器自行匹配字体，可能与编辑器内不同。

可编辑文档的标题内容折叠状态默认随 JSON / HTML 保存；大纲树自身的折叠仍是界面状态。点击大纲中被正文折叠隐藏的标题会展开其祖先并跳转；宿主也可选择独立保存标题折叠状态。插入菜单最多记录三项最近使用的命令，保存在当前站点的 `localStorage` 中；存储不可用时退回页面内存，保存的是命令标识而非文档内容。日期和可选时刻按本地日期及小时、分钟保存，不附带时区，也不进行时区换算。

格式刷单击后应用一次，双击后可连续应用，按 `Esc` 退出；它复制文字格式，不改变标题或段落类型。混合来源只复制选区中一致的格式属性。字号可用 `⌥⌘ + / -`（Windows 为 `Ctrl + Alt + / -`）按菜单档位调整。
