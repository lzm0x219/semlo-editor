# Issue tracker: GitHub

本仓库的问题和规格保存在 `lzm0x219/semlo-editor` 的 GitHub Issues 中。
在仓库内使用 `gh` 操作，创建问题前确认目标仓库。

## 常用操作

- 创建：`gh issue create --title "..." --body-file <文件>`
- 读取：`gh issue view <编号> --json number,title,body,labels,comments`
- 列表：`gh issue list --state open`，按需使用 `--label` 和 `--json`。
- 评论：`gh issue comment <编号> --body-file <文件>`
- 添加或移除标签：`gh issue edit <编号> --add-label <标签>` 或 `--remove-label <标签>`。
- 关闭：先发表评论说明原因，再执行 `gh issue close <编号>`。

## 子问题与依赖

优先使用 GitHub 原生子问题和阻塞关系：创建时使用
`gh issue create --parent <编号>` 和 `--blocked-by <编号>`；
已有问题使用 `gh issue edit <编号> --add-sub-issue <编号>` 和
`--add-blocked-by <编号>`。这些选项需要 gh 2.94 或更新版本。

不可用时，在子问题正文顶部写 `Part of #<父问题>` 和
`Blocked by: #<阻塞问题>`。所有阻塞问题关闭后才能开始。
查询原生未关闭阻塞数：
`gh api repos/{owner}/{repo}/issues/<编号> --jq .issue_dependencies_summary.blocked_by`。

## Pull requests as a triage surface

**PRs as a request surface: no.**

## 技能操作

- “发布到问题跟踪器”：创建 GitHub issue。
- “获取相关 ticket”：读取对应 GitHub issue。
- `/wayfinder` 使用 `wayfinder:map` 标记地图问题；子问题使用
  `wayfinder:<type>`（`research`、`prototype`、`grilling` 或 `task`）。
  按地图顺序选择无未关闭阻塞项且未分配的问题，通过
  `gh issue edit <编号> --add-assignee @me` 认领；完成后评论结论、
  关闭问题，并将上下文链接补充到地图的 Decisions-so-far。
