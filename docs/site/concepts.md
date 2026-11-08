---
title: 核心概念
description: 理解 semlo-editor 的文档内容、快照、控制器和应用集成边界。
---

# 核心概念

接入 semlo-editor 时，可以把编辑器看作应用中负责编辑的一部分：应用提供初始内容和服务，编辑器在内容变化时返回快照，应用再决定如何保存和展示。

## 内容与快照

创建时的 `content` 接收 ProseMirror JSON 或 HTML 字符串。编辑器维护当前文档；`onChange` 和 `getSnapshot()` 提供同一种快照，其中包含 `json`、`html` 和 `text`。

推荐使用快照中的 JSON 保存并恢复文档。HTML 和纯文本可用于应用自己的展示或处理；纯文本不是用于恢复完整文档的格式。编辑器不会自动保存内容。

```ts
const snapshot = editor.getSnapshot();
// 由应用保存 snapshot.json，并在需要时恢复。
editor.setContent(snapshot.json);
```

`setContent()` 是程序主动设置内容，不会触发 `onChange`。它会比较规范化后的文档，避免语义相同的内容反复替换。公式和整篇字体的导入导出注意事项见[内容保存与恢复](/content-and-integrations#内容保存与恢复)。

## 控制器与生命周期

`createEditor()` 返回控制器，可用于读取快照、设置内容、切换只读状态、聚焦和销毁编辑器。控制器还暴露底层 Tiptap 实例；涉及文档内容和整篇字体的保存、恢复时，应使用 semlo-editor 控制器的方法。

原生接入需要在页面卸载时调用 `destroy()`；框架组件卸载时会自动销毁。切换到另一篇文档时，建议重新挂载编辑器，以隔离撤销历史。参见[框架适配](/frameworks#更新配置与切换文档)。

## 集成回调

上传和提及搜索由应用提供：`uploadImage` 处理图片，`uploadAttachment` 处理附件及本地音视频，`searchMentions` 提供人物和文档候选项。编辑器不代替应用实现后端、权限控制或文件存储。

创建后可以用 `setIntegrations()` 整体替换集成选项，包括上述回调；未传入的项会被清除。上传和搜索示例及异步行为见[内容与集成](/content-and-integrations)。

## 文档数据与界面状态

文档内容随快照保存，但并非所有界面状态都属于文档。标题内容的折叠默认随可编辑文档保存，大纲树的折叠仅保留在当前界面；最近使用的插入命令存放在当前站点的 `localStorage` 中。字体名会随文档保存，字体文件不会。详见[字体与界面状态](/content-and-integrations#字体与界面状态)。
