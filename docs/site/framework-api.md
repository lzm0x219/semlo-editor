---
title: 框架组件 API
description: 对照 React、Vue 和 SolidJS 组件属性、事件与生命周期。
---

# 框架组件 API

三个适配器都包装同一个核心编辑器。使用前构建本地包并安装对应框架，入口见[安装与接入](/getting-started)。每个应用还需要引入 `@semlo-editor/core/style.css`。

## 属性

| 属性                         | 类型                                      | 创建后更新 | 说明                                       |
| ---------------------------- | ----------------------------------------- | ---------- | ------------------------------------------ |
| `content`                    | `EditorContent`                           | 支持       | JSON 或 HTML；程序更新不触发内容变化回调。 |
| `editable`                   | `boolean`                                 | 支持       | 默认 `true`；控制编辑或只读。              |
| `uploadImage`                | `ImageUpload`                             | 支持       | 图片和图册上传。                           |
| `uploadAttachment`           | `AttachmentUpload`                        | 支持       | 附件及本地音视频上传。                     |
| `searchMentions`             | `MentionSearch`                           | 支持       | 搜索人物与文档。                           |
| `runCode`                    | `CodeRunner`                              | 支持       | 由宿主执行代码。                           |
| `translate`                  | `TranslationService`                      | 支持       | 由宿主提供翻译服务。                       |
| `currentUser`                | `() => EditorUser \| null`                | 支持       | 提供数据表记录的用户身份。                 |
| `resolveEmbedMetadata`       | `EmbedMetadataResolver`                   | 支持       | 解析嵌入链接的书签元数据。                 |
| `yuqueContentProvider`       | `ContentPickerProvider \| null`           | 支持       | 由应用搜索或解析内容，选择后插入普通链接。 |
| `encryptedTextProvider`      | `EncryptedTextProvider \| null`           | 支持       | 由宿主处理加密和解密；安全验证尚未完成。   |
| `interactiveCardHost`        | `InteractiveCardHost \| null`             | 支持       | 应用提供的互动活动宿主。                   |
| `onInteractiveCardAbandoned` | `InteractiveInsertOptions["onAbandoned"]` | 支持       | 接收已创建但未插入的活动，供宿主安全处理。 |
| `placeholder`                | `string`                                  | 重新挂载   | 空内容提示。                               |
| `toolbar`                    | `boolean \| ToolbarFactory`               | 重新挂载   | 默认、关闭或自定义主工具栏。               |
| `floatingToolbar`            | `boolean \| FloatingToolbarFactory`       | 重新挂载   | 默认、关闭或自定义选区浮动工具栏。         |
| `outline`                    | `boolean`                                 | 重新挂载   | 是否显示大纲。                             |
| `extensions`                 | `Extensions`                              | 重新挂载   | 附加 Tiptap 扩展。                         |
| `codeBlockPreferences`       | `CodeBlockPreferencesAdapter`             | 重新挂载   | 宿主提供的代码块界面偏好。                 |
| `headingFoldPreferences`     | `HeadingFoldPreferencesAdapter`           | 重新挂载   | 宿主提供的文档标题折叠状态。               |

自定义工具栏的工厂及生命周期示例见[配置与生命周期](/configuration#自定义浮动工具栏)。所有选项的默认值和类型见 [EditorOptions](/api#editoroptions)。组件将 `class`、`id` 和事件等适用的 DOM 属性传给宿主元素。编辑器负责宿主内的节点；`children`、`dangerouslySetInnerHTML`、`innerHTML`、`innerText`、`textContent`、`outerHTML` 和 `outerText` 等会覆盖内容或替换宿主的属性会被忽略，包括 Vue 的 `.` 和 SolidJS 的 `prop:` 强制属性形式。请通过 `content` 或控制器更新文档。

## 事件

| 时机           | React / SolidJS | Vue      | 参数               |
| -------------- | --------------- | -------- | ------------------ |
| 内容变化       | `onChange`      | `change` | `EditorSnapshot`   |
| 创建完成       | `onReady`       | `ready`  | `EditorController` |
| 编辑器报告错误 | `onError`       | `error`  | `Error`            |

React 和 SolidJS 从各自入口导出 `SemloEditorProps`。Vue 的组件实例还暴露 `getEditor()`，返回控制器或尚未挂载时的 `undefined`。优先在 `ready` 中接收控制器，并在组件卸载后停止使用它。

`onReady` / `ready` 保留原有的 `EditorController` 类型。需要调用 `trySetContent()` 时，可从核心包导入 `isEditorControllerWithResults` 类型守卫；具体结果和失败语义见[编辑器控制器 API](/controller-api#trysetcontentcontent)。

## 示例：React 只读切换与读取快照

```tsx
import type { EditorController } from "@semlo-editor/core";
import { SemloEditor } from "@semlo-editor/react";
import { useRef, useState } from "react";

import "@semlo-editor/core/style.css";

export function DocumentEditor() {
  const [editable, setEditable] = useState(true);
  const controller = useRef<EditorController | null>(null);

  return (
    <section>
      <button type="button" onClick={() => setEditable((value) => !value)}>
        {editable ? "切换只读" : "继续编辑"}
      </button>
      <button type="button" onClick={() => console.log(controller.current?.getSnapshot())}>
        读取内容
      </button>
      <SemloEditor
        editable={editable}
        onReady={(value) => {
          controller.current = value;
        }}
      />
    </section>
  );
}
```

组件卸载时自动销毁编辑器。若控制器保存在比组件更长寿命的外部状态中，应用还需在卸载时清除该引用。

## 内容更新与文档切换

组件收到新的 `content` 时调用控制器的 `setContent()`；规范化后相同的内容不会重复替换，也不会触发 `onChange` / `change`。不要依赖这个回调获知应用自己写入的内容。

切换不同文档时建议重新挂载，避免复用撤销历史。React 可用 `<SemloEditor key={documentId} />`，Vue 可用 `:key="documentId"`，SolidJS 可依据文档身份重新创建组件。先保存旧文档，再切换实例。各框架的基本示例见[框架适配](/frameworks)。
