---
title: API 参考
description: 查看创建选项、编辑器控制器和公开数据类型。
---

# API 参考

从核心入口导入 `createEditor` 和类型；使用框架组件时，从对应的适配器入口导入 `SemloEditor`。完整示例见[安装与接入](/getting-started)和[框架适配](/frameworks)。

```ts
import { createEditor } from "@semlo-editor/core";
import type {
  EditorContent,
  EditorController,
  EditorControllerWithResults,
  EditorOptions,
  EditorSnapshot,
} from "@semlo-editor/core";
```

逐项方法与使用示例见[编辑器控制器 API](/controller-api)，主工具栏和浮动工具栏示例见[配置与生命周期](/configuration#自定义浮动工具栏)，组件属性和事件见[框架组件 API](/framework-api)。

## 创建编辑器

```ts
declare function createEditor(options: EditorOptions): EditorControllerWithResults;
```

### EditorOptions

| 属性                         | 类型                                      | 默认值                            | 说明                                                           |
| ---------------------------- | ----------------------------------------- | --------------------------------- | -------------------------------------------------------------- |
| `element`                    | `HTMLElement`                             | 必填                              | 挂载编辑器的元素。                                             |
| `content`                    | `EditorContent`                           | 空段落                            | 初始内容，支持 ProseMirror JSON 或 HTML 字符串。               |
| `editable`                   | `boolean`                                 | `true`                            | 是否允许编辑。                                                 |
| `placeholder`                | `string`                                  | `输入内容，或输入 / 插入更多内容` | 空内容时的提示文字。                                           |
| `toolbar`                    | `boolean \| ToolbarFactory`               | `true`                            | 默认工具栏、关闭或挂载自定义工具栏。                           |
| `floatingToolbar`            | `boolean \| FloatingToolbarFactory`       | 跟随 `toolbar`                    | 默认、关闭或替换选区浮动工具栏；显式配置可独立于主工具栏。     |
| `outline`                    | `boolean`                                 | `true`                            | 是否启用右侧大纲；有标题时显示入口。                           |
| `extensions`                 | `Extensions`                              | 无                                | 附加的 Tiptap 扩展，避免重复注册同名扩展。                     |
| `codeBlockPreferences`       | `CodeBlockPreferencesAdapter`             | 无                                | 由宿主读取和保存代码块界面偏好。                               |
| `headingFoldPreferences`     | `HeadingFoldPreferencesAdapter`           | 无                                | 由宿主按文档 ID 和版本保存标题折叠视图状态。                   |
| `runCode`                    | `CodeRunner`                              | 无                                | 由宿主执行代码；编辑器不自行运行源码。                         |
| `translate`                  | `TranslationService`                      | 无                                | 由宿主提供文本翻译服务。                                       |
| `writingService`             | `WritingService \| null`                  | 无                                | 由宿主生成写作草稿；预览后明确接纳，支持停止和重试。           |
| `writingFeedback`            | `WritingFeedbackService \| null`          | 无                                | 用户主动评价草稿时由宿主接收反馈。                             |
| `databaseAiFill`             | `DatabaseAiFillService \| null`           | 无                                | 由宿主为数据表文本列生成内容。                                 |
| `currentUser`                | `() => EditorUser \| null`                | 无                                | 提供当前用户，供数据表记录创建人和修改人。                     |
| `resolveEmbedMetadata`       | `EmbedMetadataResolver`                   | 无                                | 由宿主解析嵌入链接的书签元数据。                               |
| `uploadImage`                | `ImageUpload`                             | 无                                | 图片上传回调，接收 `File` 与可选上下文并异步返回地址。         |
| `uploadAttachment`           | `AttachmentUpload`                        | 无                                | 附件、本地音频和本地视频的上传回调，接收 `File` 与可选上下文。 |
| `resolveAttachmentPreview`   | `AttachmentPreviewResolver \| null`       | 无                                | 同步提供附件阅读页地址；未配置时打开安全原文件地址。           |
| `searchMentions`             | `MentionSearch`                           | 无                                | 搜索可提及的人物和文档。                                       |
| `yuqueContentProvider`       | `ContentPickerProvider \| null`           | 无                                | 应用提供内容搜索、链接解析及嵌入阅读页。                       |
| `encryptedTextProvider`      | `EncryptedTextProvider \| null`           | 无                                | 候选加密文本能力的宿主服务，尚未完成安全验证。                 |
| `interactiveCardHost`        | `InteractiveCardHost \| null`             | 无                                | 提供投票和打卡活动的创建、配置同步与状态服务。                 |
| `onInteractiveCardAbandoned` | `InteractiveInsertOptions["onAbandoned"]` | 无                                | 处理已创建但未插入文档的活动；宿主须先确认归属和引用。         |
| `onChange`                   | `(snapshot: EditorSnapshot) => void`      | 无                                | 文档内容更新时接收 JSON、HTML 和纯文本。                       |
| `onError`                    | `(error: Error) => void`                  | 无                                | 接收内容设置或集成过程中报告的错误。                           |

核心 API 创建后，可通过控制器更新内容、编辑状态和集成回调。框架组件也可动态更新这些属性；`placeholder`、`toolbar`、`floatingToolbar`、`outline`、`extensions`、`codeBlockPreferences` 和 `headingFoldPreferences` 在创建时确定，修改后需重新挂载组件。

`onChange` 收到的是内容变更时的快照，应用仍需自行保存；`onError` 接收编辑器报告的错误，例如 `setContent` 的无效内容或集成错误。初始内容不受支持时，`createEditor` 会清理资源并抛出异常，调用方应捕获异常并保留原始数据；这类初始化错误不通过 `onError` 报告。普通 HTML 的初始化导入仍按现有规则宽松解析。错误如何展示、重试和记录由应用决定。

快照排除从已支持的空正文容器键入后仍活跃的斜杠查询；`Esc` 将其转为正文时也会触发 `onChange`。底层 `editor` 仍持有编辑中的查询文字；保存请使用控制器快照。容器范围及受控回写规则见[保存与恢复内容](/persistence#选择保存格式)。

当前翻译请求失败会显示重试，并通过 `onError` 报告；已取消或失效的旧请求不会报告。上传回调是否实际取消网络请求取决于应用是否使用编辑器提供的中止信号。

`writingService` 可动态替换。核心包的 `getWritingAssistant(editor)` 返回该实例的写作会话，提供打开、发送、停止、重试、追问、接纳和关闭。`accept()` 接纳或替换原范围，`accept("after")` 接在保存的非空选区末尾；普通单段结果保留同段前后文。`followUp(prompt)` 会把上一合法草稿的副本放入可选的 `previousDraft` 请求字段，`retry()` 重放上次请求。生成期间不改正文，正文变化后旧目标失效。请求与结果类型、框架用法及失败恢复见[智能写作助手](/writing-assistant)。

`DatabaseAiFillRequest`、`DatabaseAiFillResult` 和 `DatabaseAiFillService` 从核心入口导出，数据表智能填写的数据范围、结果约束和生命周期见[内容与集成](/content-and-integrations#数据表智能填写)。

### FloatingToolbarFactory

```ts
interface FloatingToolbarContext extends ToolbarContext {
  openLink(anchor?: HTMLElement): void;
}

type FloatingToolbarFactory = (context: FloatingToolbarContext) => void | (() => void);
```

工厂接收实例专用的 `element`、`controller`、`syncSelection()` 和 `subscribe()`，并可用 `openLink()` 打开内置链接弹层。它同步执行，可返回一次性清理函数。省略 `floatingToolbar` 时，浮动工具栏跟随 `toolbar`；显式传入 `true`、`false` 或工厂可独立设置。调用时序、订阅和示例见[自定义浮动工具栏](/configuration#自定义浮动工具栏)。

### 加粗命令

```ts
import { getBoldState, toggleBold } from "@semlo-editor/core";
import type { BoldState } from "@semlo-editor/core";

const state: BoldState = getBoldState(controller.editor);
const handled = toggleBold(controller.editor);
```

`getBoldState` 返回当前选区的 `active` 和 `enabled`。只读、仅标题选区以及视图卸载或实例销毁时不可用；卸载或销毁后两项均为 `false`。`active` 即使只读也可读取；跨标题和正文时，只根据可加粗的非标题内容判断，与命令的作用范围一致。`toggleBold` 在这种混合选区中保留标题格式，只切换其他选中内容；不可用时返回 `false`。返回 `true` 表示命令已处理，不保证事务一定被宿主接受或内容发生变化。

命令默认将焦点交回正文；`toggleBold(editor, { focus: false })` 可保留当前焦点。它使用编辑器已有选区，不主动读取浏览器选区；自定义工具栏在适当时机调用 `syncSelection()`。使用 `subscribe()` 在事务及控制器只读状态变化后更新控件。底层 `editor.commands.toggleBold()` 仍是 Tiptap 命令，不包含这套标题选区规则；需要与默认界面一致时使用核心包导出的命令。

### 标题折叠状态与版本

```ts
import { captureHeadingFoldRevision } from "@semlo-editor/core";
import type { HeadingFoldRevisionCapture } from "@semlo-editor/core";

const capture: HeadingFoldRevisionCapture | null = captureHeadingFoldRevision(controller);
```

配置标题折叠适配器后，可在保存文档前捕获内容和折叠状态；保存成功后调用 `capture.commit(revision)`，将状态关联到该内容版本。保存期间的后续编辑、过期提交、存储失败及框架接入示例见[标题折叠视图状态](/persistence#标题折叠视图状态)。

### 标题与正文样式命令

```ts
import { getHeadingStyleState, setHeadingStyle, toggleHeadingStyle } from "@semlo-editor/core";
import type { HeadingStyleLevel, HeadingStyleState } from "@semlo-editor/core";

const level: HeadingStyleLevel = 2; // 0 为正文，1–6 为对应级别的标题
const state: HeadingStyleState = getHeadingStyleState(controller.editor);
const setFromMenu = () => setHeadingStyle(controller.editor, level);
const toggleFromButton = () => toggleHeadingStyle(controller.editor, level);
```

`getHeadingStyleState` 返回与默认标题菜单一致的 `level` 和 `enabled`。`level` 为 1–6 时表示统一的标题级别，为 `null` 时表示没有统一样式或视图已卸载、销毁；`0` 是菜单的正文显示值，其他类型的文本块也可能沿用这一显示值，不能据此断言选区全部是正文。只读时仍可读取样式，但 `enabled` 为 `false`。

`enabled` 描述默认工具栏是否允许尝试，不保证所有复杂选区都能转换。折叠卡片标题或同一卡片标题与正文的跨区选区会禁用标题菜单；为保留既有键盘行为，命令不会仅根据这一菜单状态拒绝调用，跨区时仍可能转换卡片正文。自定义菜单或按钮可依据 `enabled` 决定是否禁用。

`setHeadingStyle` 显式设置样式，重复设置相同样式不会切回正文；`toggleHeadingStyle` 在选区全部为同级标题时切回正文，其他情况切换到指定标题。两者的 `0` 都表示设置正文。无效级别、只读、视图不可用、无法安全转换或未接受的事务会返回 `false`；没有可执行变化时也可能返回 `false`。返回 `true` 表示命令处理成功，不单独保证内容发生变化。

命令使用编辑器已有选区并沿用默认的聚焦、格式清理与撤销规则：转换会清理加粗、斜体等样式及字号，保留文字颜色和高亮。自定义工具栏可通过 `syncSelection()` 同步浏览器选区，并用 `subscribe()` 更新状态。底层 Tiptap 标题命令不包含 Semlo 的完整转换规则。

### 链接命令与状态

```ts
import { getLinkState, normalizeLinkURL, startLinkEdit } from "@semlo-editor/core";
import type { LinkEditResult, LinkEditSession, LinkState } from "@semlo-editor/core";

const state: LinkState = getLinkState(controller.editor);
const session: LinkEditSession | null = startLinkEdit(controller.editor);
const normalized = normalizeLinkURL("example.com/guide"); // https://example.com/guide
if (session) {
  const result: LinkEditResult = session.apply({ text: session.text, href: "#section" });
}
```

`getLinkState` 返回与默认链接按钮一致的 `active` 和 `enabled`。只读时仍可读取选中状态，视图卸载或销毁后两项均为 `false`；跨文本块选区的 `enabled` 为 `false`，链接编辑限于同一正文、标题或其他文本块内。`enabled` 表示按钮允许尝试，具体 schema 不支持链接时，开始编辑仍可能失败。

`startLinkEdit` 使用编辑器已有选区，返回与界面无关的会话；只读、视图不可用或当前选区无法开始编辑时返回 `null`，跨文本块时不创建占位、不改变内容或选区。新建链接时，调用会立即给选中文字添加无地址占位；空光标处插入默认的“链接”占位。新占位使用默认链接色，移除选中文字的显式前景色和渐变，保留字号、背景色及其他文字样式；这与占位共用一个可撤销事务。编辑已有链接保留其自定义颜色；空光标处会扩展到整段链接。占位和确认地址保留原有的分步撤销行为。

会话提供创建时的 `text`、`href`、`existing` 和目标 `range`。`apply({ text, href })` 校验地址并写入链接，返回 `applied`、`invalid-url`、`invalid-text`、`unavailable` 或 `rejected`。`applied` 表示命令处理成功，不单独保证文档发生变化；无效输入保留会话供修正。`remove()` 移除已有链接并返回是否处理成功。单纯的选区变化不会改变会话目标；自定义界面可自行选择是否在选区变化时关闭。

`normalizeLinkURL` 与默认弹层使用同一规则：接受 HTTP、HTTPS、`mailto:`、站内路径、锚点和 `./`、`../` 相对路径，裸域名补全 `https://`；无效或不支持的地址返回 `null`。修改链接文字时沿用默认规则保留首个选中文字的格式。

文档变更或替换、切换只读、卸载及销毁会使会话失效，失效后不能再提交。可通过 `startLinkEdit(editor, { onInvalidate })` 同步收到一次失效通知；会话自身的成功写入也可能触发该通知，回调异常会传给触发操作的调用方。`isValid()` 可检查当前会话；调用方关闭界面或卸载时应调用可重复执行的 `close()`。关闭只释放会话，不移除已创建的占位，也不自动移动焦点。

自定义工具栏应在需要时调用 `syncSelection()` 同步浏览器选区，并通过 `subscribe()` 更新按钮状态。自定义浮动工具栏也可继续使用 `openLink()` 打开内置弹层；自行实现表单时可使用上述会话。

### 列表命令

```ts
import { getListState, toggleList } from "@semlo-editor/core";
import type { ListKind, ListState } from "@semlo-editor/core";

const kind: ListKind = "bulletList"; // 也支持 "orderedList" 和 "taskList"
const state: ListState = getListState(controller.editor, kind);
const handled = toggleList(controller.editor, kind);
```

`getListState` 返回当前列表类型的 `active` 和 `enabled`，与默认工具栏使用相同规则。只读时仍可读取选中状态，但不能执行命令；视图卸载或实例销毁时两项均为 `false`。无序和有序列表在折叠卡片标题及同一卡片的标题与正文跨选区中不可用；待办按钮沿用原有显示规则。

`enabled` 表示当前工具栏允许尝试该操作，不保证所有复杂选区都可安全转换。对于暂不支持的列表结构，`toggleList` 返回 `false` 并保留文档；返回 `true` 表示命令已处理，不保证事务一定被宿主接受。受支持的部分列表转换保留未选中项及缩进，创建有序列表时沿用该实例选择的样式，并沿用现有选区及撤销规则。

命令使用编辑器已有选区，成功执行时沿用默认工具栏的聚焦行为；自定义工具栏可通过 `syncSelection()` 和 `subscribe()` 分别同步选区和更新状态。底层 Tiptap 列表命令不包含上述 Semlo 转换规则；需要与默认界面一致时使用核心包的 `toggleList`。

### 投票与打卡宿主

投票和打卡需要应用提供 `interactiveCardHost`。宿主实现 `createActivity`、`verifyConfiguration` 和 `syncConfiguration`，并为要使用的类型提供 `vote` 或 `checkin` 服务。通过插入菜单创建活动时，还必须提供 `onInteractiveCardAbandoned`；缺少对应能力时入口不可用。

`createActivity(config, copiedFrom, signal)` 返回包含新活动 ID 的 `{ cardId }`；复制已有活动时，新 ID 不能与来源相同。`verifyConfiguration(cardId, config, signal)` 返回服务端配置是否与文档一致；`syncConfiguration(cardId, config, signal)` 保存配置。投票服务提供 `getStatus`、`submitVote`，打卡服务提供 `getStatus`、`checkIn`；具体签名可从 `@semlo-editor/core` 导入 `InteractiveCardHost`、`VoteService` 和 `CheckinService` 类型查看。

投票选项支持非空且互不重复的 `id` 和字符串 `label`。额外的 JSON 字段随文档保留，但不会传给宿主投票服务；应用仍需自行确认这些字段的含义。如果选项载荷损坏或 ID 重复，编辑器保留原始数据并提示暂不可编辑或参与，也不会同步该投票配置。

活动创建完成后，若插入目标失效、操作取消或插入失败，`onInteractiveCardAbandoned` 会收到活动 ID、配置、原因和创建时的宿主；回调可能在插入操作返回之后调用。宿主应确认活动归属及是否仍被引用，再决定如何清理，不能仅凭回调直接删除其他用户的数据。

截止日期使用 `YYYY-MM-DD` 或本地墙上时间 `YYYY-MM-DDTHH:mm[:ss]`；时区由宿主定义。无效截止日期的原始值会随内容保留，编辑器提示不支持并暂停配置同步和活动参与。宿主负责认证、权限、截止时间、服务端数据校验和跨客户端写入顺序。编辑器只在当前实例内串行化同一活动的配置写入；复制卡片不会继承原活动 ID。

运行时更换用户身份或宿主时，应通过 `setIntegrations()` 传入新的宿主对象，并一并保留其他需要的集成选项；只在原对象内部更改身份不会触发宿主替换。框架组件可更新 `interactiveCardHost` 属性。这个接口是 semlo-editor 的接入约定，不表示已接入语雀投票或打卡服务。

## EditorController

| 成员                            | 说明                                                     |
| ------------------------------- | -------------------------------------------------------- |
| `getSnapshot()`                 | 返回当前的 `EditorSnapshot`。                            |
| `setContent(content)`           | 设置 JSON 或 HTML 内容；程序调用不会触发 `onChange`。    |
| `trySetContent(content)`        | `EditorControllerWithResults` 提供；返回明确的替换结果。 |
| `setEditable(editable)`         | 切换编辑或只读状态。                                     |
| `setIntegrations(integrations)` | 整体替换集成选项；未提供的项会被清除。                   |
| `focus()`                       | 将焦点移入编辑器。                                       |
| `destroy()`                     | 销毁编辑器并释放其界面和监听器；重复调用安全。           |
| `editor`                        | 底层 Tiptap `Editor` 实例。                              |

各方法的参数、失败处理、事务边界和生命周期详见[编辑器控制器 API](/controller-api)。内容格式和持久化见[内容与集成](/content-and-integrations)，上传和搜索见[上传与提及](/uploads-and-mentions)。

## 数据类型

```ts
type EditorContent = JSONContent | string;

interface EditorSnapshot {
  json: JSONContent;
  html: string;
  text: string;
}

interface MentionItem {
  id: string;
  label: string;
  kind: "person" | "document";
  href?: string;
}

type ImageUpload = (file: File, context?: { signal: AbortSignal }) => Promise<string>;
type AttachmentUpload = (file: File, context?: { signal: AbortSignal }) => Promise<string>;
interface AttachmentInfo {
  href: string;
  name: string;
  size: number;
  mimeType: string;
}
type AttachmentPreviewResolver = (attachment: AttachmentInfo) => string | null | undefined;
type MentionSearch = (query: string, signal: AbortSignal) => MentionItem[] | Promise<MentionItem[]>;

interface ContentChoice {
  id: string;
  title: string;
  href: string;
  kind: "document" | "table";
  description?: string;
}

interface ContentEmbedTarget {
  url: string;
  allowSameOrigin?: boolean;
}

interface ContentPickerProvider {
  search(query: string, signal: AbortSignal): Promise<readonly ContentChoice[]>;
  resolveLink(link: string, signal: AbortSignal): Promise<ContentChoice | null>;
  resolveEmbed?(choice: ContentChoice): string | ContentEmbedTarget | null | undefined;
}
```

`JSONContent` 和 `Extensions` 也可从核心入口导入。React 与 SolidJS 的组件入口各自导出 `SemloEditorProps`；Vue 组件通过 `change`、`ready` 和 `error` 事件提供对应回调。

## 入口与框架事件

| 入口                           | 内容                                                                |
| ------------------------------ | ------------------------------------------------------------------- |
| `@semlo-editor/core`           | `createEditor`、公开类型，以及 `JSONContent` 和 `Extensions` 类型。 |
| `@semlo-editor/react`          | React 的 `SemloEditor` 和 `SemloEditorProps`。                      |
| `@semlo-editor/vue`            | Vue 的 `SemloEditor`。                                              |
| `@semlo-editor/solid`          | SolidJS 的 `SemloEditor` 和 `SemloEditorProps`。                    |
| `@semlo-editor/core/style.css` | 编辑器样式。                                                        |

| 用途     | React / SolidJS       | Vue       |
| -------- | --------------------- | --------- |
| 内容变化 | `onChange(snapshot)`  | `@change` |
| 实例就绪 | `onReady(controller)` | `@ready`  |
| 错误报告 | `onError(error)`      | `@error`  |

框架组件卸载时自动销毁实例。各框架的完整接入示例见[框架适配](/frameworks)。
