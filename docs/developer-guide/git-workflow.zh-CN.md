---
title: Git 工作流
---

# Git 工作流

Routa 采用严格的小步提交（baby-step commit）模型，以保持变更的可审查性，并让回归问题保持可追溯。

## 提交规则

- 一次提交应只代表一个关注点：功能、修复或重构。
- 使用 Conventional Commits 格式。
- 不要将无关的变更混入同一次提交。
- 控制影响范围尽量小：每次提交少于 `10` 个文件、少于 `1000` 行改动。
- 在适用时附上相关的 GitHub issue ID。

## 工作规则

- 使用聚焦的分支。
- 对于非平凡的 bug 或故障，优先采用 issue 优先（issue-first）的工作方式。
- 不要带着未经验证的源码改动开启 PR。
- 如果公共行为、命令或工作流发生变化，请在同一变更集中同步更新文档。
- 如果你还运行着一个带有长期本地补丁的自托管 Routa，请把这些补丁保存在专门的 overlay 分支中，而不是默认的 PR 分支里。参见 [Local Overlay And Upstream Sync](/developer-guide/local-overlay-sync)。

## Pull Request 期望

- 说明用户可见的变更及其背后的理由。
- 为 UI 变更附上截图或录屏。
- 列出你运行过的检查。
- 在适用时关联相关的 issue。

## 这些规则的来源

仓库的权威策略仍然位于 [AGENTS.md](https://github.com/phodal/routa/blob/main/AGENTS.md#git-discipline)。
请将本页作为公开摘要，并以该文件作为完整的规则来源。
