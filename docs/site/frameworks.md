---
title: 框架适配
description: 在 Vue、React 和 SolidJS 应用中使用 semlo-editor 编辑器。
---

# 框架适配

三个适配器都接收 `content`、`editable` 和上传、提及回调。内容变化时分别通过 Vue 的 `change` 事件或 React、SolidJS 的 `onChange` 回调返回快照；组件卸载时自动销毁编辑器。下面的示例将 JSON 保存在组件状态中，刷新页面后不会自动恢复。

组件负责管理宿主元素内部的内容，不支持通过子节点或 `innerHTML` 等 DOM 属性替换。请使用 `content` 更新文档，具体属性限制见[框架组件 API](/framework-api#属性)。

## Vue 3

```vue
<script setup lang="ts">
import { ref } from "vue";
import { SemloEditor } from "@semlo-editor/vue";
import type { EditorContent, EditorSnapshot } from "@semlo-editor/core";
import "@semlo-editor/core/style.css";

const content = ref<EditorContent>({ type: "doc", content: [{ type: "paragraph" }] });
function onChange(snapshot: EditorSnapshot) {
  content.value = snapshot.json;
}
</script>

<template>
  <SemloEditor :content="content" @change="onChange" />
</template>
```

可用 `@ready` 接收控制器，`@error` 处理内容设置或上传错误。组件卸载时自动销毁编辑器。

## React

```tsx
import type { EditorContent } from "@semlo-editor/core";
import { SemloEditor } from "@semlo-editor/react";
import { useState } from "react";

import "@semlo-editor/core/style.css";

export function DocumentEditor() {
  const [content, setContent] = useState<EditorContent>({
    type: "doc",
    content: [{ type: "paragraph" }],
  });
  return <SemloEditor content={content} onChange={(value) => setContent(value.json)} />;
}
```

## SolidJS

```tsx
import type { EditorContent } from "@semlo-editor/core";
import { SemloEditor } from "@semlo-editor/solid";
import { createSignal } from "solid-js";

import "@semlo-editor/core/style.css";

export function DocumentEditor() {
  const [content, setContent] = createSignal<EditorContent>({
    type: "doc",
    content: [{ type: "paragraph" }],
  });
  return <SemloEditor content={content()} onChange={(value) => setContent(value.json)} />;
}
```

## 更新配置与切换文档

`content`、`editable`、`uploadImage`、`uploadAttachment`、`resolveAttachmentPreview`、`searchMentions`、`writingService` 和 `writingFeedback` 可以在组件挂载后更新。附件阅读页接入见[上传与提及](/uploads-and-mentions#附件预览)，写作服务及请求生命周期见[智能写作助手](/writing-assistant)。`placeholder`、`toolbar`、`floatingToolbar`、`outline` 和 `extensions` 在创建时确定；如需更改，重新挂载组件。

切换到另一篇文档时也建议重新挂载，避免沿用上一份文档的撤销历史。例如，在 React 中可使用文档 ID 作为 `key`：

```tsx
<SemloEditor key={documentId} content={content} onChange={handleChange} />
```

这里的 `documentId`、`content` 和 `handleChange` 由应用提供。Vue 可使用 `:key="documentId"`；SolidJS 可根据文档身份重新创建组件。重挂载前请由应用保存需要保留的内容。

Vue 可通过 `@ready` 获取控制器，React 和 SolidJS 使用 `onReady`。需要在保存后迁移标题折叠状态时，可将该控制器传给核心包的 `captureHeadingFoldRevision()`，流程见[保存与恢复内容](/persistence#标题折叠视图状态)。所有选项与控制器方法见 [API 参考](/api)。
