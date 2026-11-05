---
title: 本地开发
description: 构建组件库，运行体验页、文档站和项目检查。
---

# 本地开发

项目使用 mise 固定 Node.js 26.13.0 和 pnpm 12.16.1。安装 mise 后，在项目目录执行：

```sh
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm build
mise exec -- pnpm dev
```

浏览器打开终端显示的本地地址。点击体验页顶部的“查看全部示例”，或从菜单中选择分类示例；“编辑操作”提供格式刷、字体、查找替换等练习内容。“自定义工具栏”示例使用公开的工具栏工厂，可在四种框架模式下练习标题、加粗、链接和列表。数据表提供字段示例以及可直接打开的表格、画册、看板、日历和图表视图。每个分类示例是独立副本，单个数据表内的视图共享记录。切换示例或 Vue、React、SolidJS、原生 JavaScript 时，各示例的临时修改会保留。点击“恢复示例”重置当前示例，刷新页面会重置所有示例，它不是持久化存储。

示例覆盖已实现的文字样式与段落、列表、表格、数据表、内容块、分栏、公式、文本绘图、图片与图册、附件及音视频、日历、提及和第三方嵌入；文字颜色、图片样式、对齐、表格和分栏布局也有可编辑的变体。

示例自带的图片、附件和音视频随体验页打包；手动上传的文件使用浏览器临时地址，刷新后不可继续访问。提及列表中的人物和文档是示例数据，第三方嵌入需要确认链接后才加载。

体验页和文档站分别由 `demo/`、`docs/` 工作区管理依赖；浏览器测试依赖、通用检查工具和统一命令由根工作区管理。

核心源码按编辑器组合、功能、运行时、共享能力和默认界面分目录维护。内部职责、样式顺序、测试组织及命名和注释约定见仓库中的 `docs/architecture.md`。

工作区共享的外部依赖版本集中在 `pnpm-workspace.yaml` 的 `catalog` 中，更新这些依赖时请修改对应的精确版本；包内的 `catalog:` 引用会使用该版本。`pnpm build` 按依赖顺序构建所有组件包。

组件库由 Rslib 构建，体验页使用 Rsbuild。可运行 `mise exec -- pnpm build:demo` 构建体验页，或在构建后运行 `mise exec -- pnpm preview` 预览。

项目使用 Oxlint 和 Oxfmt 检查代码。执行 `mise exec -- pnpm lint`、`mise exec -- pnpm format:check` 和 `mise exec -- pnpm typecheck` 可检查代码；`mise exec -- pnpm lint:fix` 与 `mise exec -- pnpm format` 分别修复可自动修复的检查项和格式。

使用 Rstest 运行测试：`mise exec -- pnpm test`。浏览器回归通过 Playwright 在隔离的 Chromium 页面中执行；首次运行若提示浏览器缺失，可执行 `mise exec -- pnpm exec playwright install chromium`。

## 文档站

文档源文件位于 `docs/site`。在项目目录执行：

```sh
mise exec -- pnpm docs:dev
```

根据终端提示打开本地地址，编辑 Markdown 后可在浏览器中查看更新。构建和预览文档站：

```sh
mise exec -- pnpm docs:build
mise exec -- pnpm docs:preview
```

静态文件输出到 `doc_build/`。`docs/reference.md` 和 `docs/validation.md` 是项目内部的参考及验证记录，不属于文档站页面。
