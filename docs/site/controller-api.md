---
title: 编辑器控制器 API
description: 逐项了解创建编辑器、控制器方法、内容更新和生命周期。
---

# 编辑器控制器 API

核心入口导出 `createEditor` 和 `EditorController`。包尚未发布，名称为 `@semlo-editor/core`。安装步骤见[安装与接入](/getting-started)。

## createEditor(options)

```ts
function createEditor(options: EditorOptions): EditorControllerWithResults;
```

将编辑器挂载到 `options.element`，返回控制器。此接口需要浏览器 DOM：在应用的客户端生命周期中创建，并在卸载时销毁。

```ts
import { createEditor } from "@semlo-editor/core";

import "@semlo-editor/core/style.css";

const host = document.querySelector<HTMLElement>("#editor");
if (!host) throw new Error("缺少挂载元素");

const controller = createEditor({
  element: host,
  content: "<p>开始写作</p>",
  onChange: ({ json }) => console.log(json),
  onError: (error) => console.error(error),
});
```

创建阶段若抛出异常，调用方应处理异常；`onError` 用于接收编辑器报告的内容设置及集成错误，不应视作捕获所有创建异常的替代。完整选项、默认值和类型见 [API 参考](/api#创建编辑器)。

## getSnapshot()

```ts
getSnapshot(): EditorSnapshot
```

返回当前内容的 `json`、`html` 和 `text`。推荐保存 JSON；HTML 可用于其他展示场景，纯文本不包含完整结构。

```ts
const { json, html, text } = controller.getSnapshot();
console.log(json, html, text);
```

整篇字体的 HTML 包装及有序列表导出处理由 semlo-editor 的快照方法完成。使用底层 Tiptap 实例直接取 HTML 时，不应假定具有相同处理。内容持久化见[保存与恢复内容](/persistence)。

## setContent(content)

```ts
setContent(content: EditorContent): void
```

以 ProseMirror JSON 或 HTML 替换当前内容。方法会先解析并比较规范化后的文档；内容相同时不重复替换。调用不会触发 `onChange`；无效内容通过 `onError` 报告，而不是通过返回值表示失败。

使用 JSON 初始化或替换内容时，编辑器会复制其中的普通对象和数组，包括嵌套属性。此后修改传入的 JSON 不会直接改变编辑器；如需应用修改，应再次调用 `setContent()`。`getSnapshot().json` 也是独立快照，修改它不会直接修改编辑器文档。

事务尚未提交时，例如在同一实例的 `beforeTransaction` 回调中，不能同步替换为不同文档。此时 `setContent` 会抛出 `ReentrantTransactionError`，不会开始替换；内容相同的调用仍是无操作。如果回调在提交前销毁或卸载编辑器，受影响的事务会抛出 `TransactionAbortedError`。这两类异常由调用方捕获，不通过 `onError` 代替抛出。应用可在事务提交后重新读取当前状态，再决定是否执行替换。

```ts
controller.setContent({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "新的内容" }] }],
});
```

替换不同内容时，未完成上传的旧结果不会写入替换后的文档。切换到另一篇文档建议重新创建实例，以隔离撤销历史；先由应用保存当前文档。

## trySetContent(content)

```ts
trySetContent(content: EditorContent): ContentReplacementResult
```

与 `setContent()` 使用相同的替换路径，但返回本次调用的结果：

| 状态 | 含义 |
| --- | --- |
| `applied` | 同步调用结束时，当前文档与规范化后的目标内容一致。 |
| `unchanged` | 目标内容与现有文档相同，没有进行替换。 |
| `unavailable` | 调用开始时实例不可用。 |
| `interrupted` | 操作中断；`reason` 区分事务重入、销毁、卸载、被更新的文档取代或未应用等情况。相关错误会附在 `error` 中。 |
| `parse-failed` | 解析或校验阶段失败；不单独推断是原内容还是宿主扩展造成。 |
| `failed` | 替换过程的其他步骤失败。 |

`parse-failed` 和 `failed` 携带 `error`，并按原有约定通知 `onError`；`onError` 本身抛出的异常仍向调用方传播。结果只描述同步调用结束时的状态，不代表内容已经持久化，也不保证之后不会被修改。和 `setContent()` 一样，程序替换不触发 `onChange`。

核心 `createEditor()` 的返回值可直接调用该方法。框架组件的 `onReady` 为兼容旧类型仍接收 `EditorController`；可使用从核心包导入的 `isEditorControllerWithResults(controller)` 类型守卫后调用。Vue 组件实例的 `getEditor()` 返回的控制器也提供此方法。

## setEditable(editable)

```ts
setEditable(editable: boolean): void
```

切换编辑或只读状态，默认可编辑。变为只读时，编辑器会清理相关上传占位、关闭编辑弹层并中止对应上传信号；旧上传结果不会写入文档，应用须在回调中使用该信号才能取消网络请求。权限仍由应用和服务端负责。

## setIntegrations(integrations)

```ts
setIntegrations(integrations: EditorIntegrations): void
```

`EditorIntegrations` 可从核心包导入，包含上传、搜索、代码运行、翻译、当前用户及各内容提供方等动态集成选项，不包含创建时确定的界面配置。

**整体替换**集成选项。需要保留的选项必须一并传入；省略某项即清除它。

```ts
controller.setIntegrations({ uploadImage, uploadAttachment, searchMentions });
// 只保留搜索，清除两个上传回调：
controller.setIntegrations({ searchMentions });
```

已有上传继续使用启动时的回调；变更提及搜索提供方会中止旧搜索并刷新。变更语雀内容提供方会关闭其选择面板并使旧结果失效。参数与示例见[上传与提及](/uploads-and-mentions)。

配置变更时，各项相关通知分别执行；某项通知抛错不会阻止其余通知。单个错误会原样抛出，多个错误以 `AggregateError` 抛出。失败的通知可通过再次传入完整配置重试；若通知同步触发另一次配置更新，以最近一次完整配置为准。

更换或清除加密文本提供方时，已打开的加密会话立即失效并中止其 `AbortSignal`；弹层保留草稿和密码供用户处理，但不能继续提交，需要关闭后重新打开以使用新提供方。销毁、卸载或切换编辑状态会关闭会话并清空草稿。宿主应响应中止信号；中止不能撤销已经发生的网络请求或服务端副作用。加密接入仍是尚未完成安全验证的候选方案。

## focus() 与 destroy()

`focus(): void` 将焦点移入编辑器。`destroy(): void` 销毁实例并释放 semlo-editor 创建的界面和监听器，重复调用安全。应用自行创建的监听器、定时器和请求仍需自行清理。销毁后不应继续使用该控制器。

## editor

`controller.editor` 是只读属性，暴露底层 Tiptap `Editor` 实例，可用于需要 Tiptap 能力的高级集成。该属性只限制引用重新赋值，底层实例本身仍可变。直接操作其命令、扩展或视图时，应用需要自行评估对 Semlo Editor 内容格式、界面状态和生命周期的影响；Semlo 控制器的快照、替换和只读方法提供的处理不能自动视为底层调用的保证。保存、恢复和切换只读优先使用控制器方法。

切换只读应使用控制器的 `setEditable()`。直接调用底层 `editor.setEditable(false, false)` 会关闭更新通知，编辑器无法立即中止正在进行的上传；结果返回时才会检查只读状态。

事务保护适用于通过编辑器正常派发的操作，包括遵循正常事务转发的 `view.setProps` 和 `registerPlugin` 集成。不要直接替换 `view.dispatch`、直接安装编辑器状态或吞掉事务异常；这些操作会绕过保护，调用方可能看不到失败。事务提交后，插件的 `view.update` 和正常的 `appendTransaction` 仍可按 ProseMirror 机制工作。

```ts
import { ReentrantTransactionError, TransactionAbortedError } from "@semlo-editor/core";

try {
  controller.setContent(savedDocument);
} catch (error) {
  if (error instanceof ReentrantTransactionError || error instanceof TransactionAbortedError) {
    // 应用应根据当前编辑器状态决定如何处理；不要在未提交的回调中立即重试。
  } else {
    throw error;
  }
}
```
