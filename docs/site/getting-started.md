---
title: 安装与接入
description: 从本地构建并安装 semlo-editor，在 Web 应用中创建第一个编辑器。
---

# 安装与接入

semlo-editor 仍在开发中，组件包名为 `@semlo-editor/core`，尚未发布。下面以本地包和 pnpm 为例，介绍如何在已有的 Web 项目中接入。

## 1. 构建组件库

在 semlo-editor 项目目录执行：

```sh
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm build
```

构建结果位于 `packages/core/dist/`。项目工具链和体验页的启动方式见[本地开发](/development)。

## 2. 添加本地依赖

假设仓库目录名为 `semlo`，且与应用目录处于同一级，在应用目录执行：

```sh
pnpm add file:../semlo/packages/core
```

如果目录结构不同，请把路径换成从应用目录指向 semlo-editor 项目的相对路径。你也可以使用工作区依赖或本地打包文件；使用 Vue、React 或 SolidJS 时，还需安装对应的本地适配器包（`packages/vue`、`packages/react` 或 `packages/solid`）和相应框架。

每次修改 semlo-editor 源码后，需要重新构建组件库。对于 `file:` 安装，按你的包管理器行为重新安装或更新应用中的依赖，以确保应用使用最新构建结果。

## 3. 创建编辑器

在应用页面中提供一个挂载元素：

```html
<div id="editor"></div>
```

在通过打包工具处理的 TypeScript 入口中引入样式并创建编辑器：

```ts
import { createEditor } from "@semlo-editor/core";

import "@semlo-editor/core/style.css";

const host = document.querySelector<HTMLElement>("#editor");
if (!host) throw new Error("找不到编辑器挂载元素");

const editor = createEditor({
  element: host,
  content: { type: "doc", content: [{ type: "paragraph" }] },
  onChange: ({ json }) => {
    console.log(json); // 在这里接入应用自己的保存逻辑
  },
  onError: (error) => console.error(error),
});
```

现在可以在页面中输入内容。创建后可通过 `editor.getSnapshot()` 获取当前内容，用 `editor.setEditable(false)` 切换为只读。页面或组件卸载时调用 `editor.destroy()`，释放编辑器及其监听器。

该示例只在内存中编辑，不会自动保存或上传文件。接下来可以：

- 按[保存与恢复内容](/persistence)保存文档快照。
- 按[上传与提及](/uploads-and-mentions)连接应用服务。
- 查看[框架适配](/frameworks)中的 Vue、React 和 SolidJS 示例。
- 阅读[配置与生命周期](/configuration)，了解只读、扩展和销毁。
