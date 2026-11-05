---
title: 认识 semlo-editor
description: 了解 semlo-editor 的定位、接入方式和当前能力边界。
---

# 认识 semlo-editor

semlo-editor 是一套面向 Web 的富文本编辑器，提供编辑界面、内容处理能力，以及 React、Vue 和 SolidJS 适配器。它适合需要在应用中加入文档编辑体验的开发者。

项目仍在开发中。组件包名为 `@semlo-editor/core`，尚未发布；现阶段需要从本地构建并安装。semlo-editor 使用 Tiptap 构建。

## 从哪里开始

- **先跑起来**：[安装与接入](/getting-started)介绍本地构建、安装和创建编辑器。
- **接入现有应用**：[框架适配](/frameworks)提供 Vue、React 和 SolidJS 示例。
- **理解数据流**：[核心概念](/concepts)解释内容、快照、控制器与应用的职责。
- **查找具体接口**：[API 参考](/api)列出选项、方法和公开类型。

接入以后，可以按任务继续阅读：[编辑与组织内容](/editing)、[保存与恢复内容](/persistence)、[上传与提及](/uploads-and-mentions)，以及[配置与生命周期](/configuration)。遇到问题时查看[常见问题](/troubleshooting)。

## 编辑器负责什么

semlo-editor 提供工具栏、大纲和编辑区域，处理文档编辑，并通过快照提供 JSON、HTML 和纯文本。图片、附件和提及等功能通过回调与应用的服务连接。

应用负责保存和恢复内容、实现上传与搜索服务、处理权限，以及在合适的时机销毁或重新挂载编辑器。semlo-editor 本身不提供持久化服务或多人协作。完整功能和未实现的能力见[功能与限制](/features)。

## 下一步

按照[安装与接入](/getting-started)创建第一个编辑器，或者先在[首页](/)体验编辑界面。
