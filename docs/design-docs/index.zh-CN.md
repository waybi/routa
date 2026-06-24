---
title: 设计文档
hide_table_of_contents: true
---

# 设计文档

设计文档解释了 Routa 为何呈现现在的形态。当产品行为、系统边界或长期不变量比安装步骤更重要时，请阅读本节。

如果你仍在尝试让 Routa 跑起来，请回到 [快速开始](/quick-start)、
[平台](/platforms) 或 [使用 Routa](/use-routa)。

## 选择一条阅读路径

<div className="routa-doc-map">
  <a href="/routa/ARCHITECTURE">
    <strong>架构</strong>
    当你需要了解系统边界、运行时拓扑以及 Web 端/桌面端对等模型时，从这里开始。
  </a>
  <a href="/routa/adr">
    <strong>架构决策</strong>
    当你需要了解 Provider、工作区、看板自动化和专家加载背后的持久决策时，阅读 ADR 索引。
  </a>
  <a href="/routa/design-docs/execution-modes">
    <strong>执行模式</strong>
    在更改工作流行为之前，理解 `Session`、`Kanban` 和 `Team` 的产品含义。
  </a>
  <a href="/routa/design-docs/workspace-centric-redesign">
    <strong>以工作区为中心的重新设计</strong>
    用它来理解当前的产品形态、已交付的变更，以及尚未偿还的过渡债务。
  </a>
  <a href="/routa/design-docs/core-beliefs">
    <strong>核心信念</strong>
    阅读那些应在重构和 UI 变更中得以存续的产品与仓库原则。
  </a>
</div>

## 你能从本节获得什么

<div className="routa-start-grid">
  <div className="routa-start-card">
    <span className="routa-start-card__badge">边界</span>
    <h3>系统形态</h3>
    <p>了解哪些职责归属于 Web 应用、桌面端运行时、服务器以及 ACP 层。</p>
  </div>
  <div className="routa-start-card">
    <span className="routa-start-card__badge">产品模型</span>
    <h3>真正重要的核心概念</h3>
    <p>将工作区、仓库、Provider、Session、Kanban 和 Team 理解为持久的产品对象。</p>
  </div>
  <div className="routa-start-card">
    <span className="routa-start-card__badge">决策历史</span>
    <h3>为何它如此运作</h3>
    <p>当某项变更可能与一项有意为之的系统决策相冲突时，借助 ADR 和重新设计笔记来判断。</p>
  </div>
</div>

## 聚焦的设计材料

当你已经了解主要产品模型、需要更窄的专题时使用：

- [agentwatch-tui.md](./agentwatch-tui.md)：Harness Monitor 的 TUI 优先运行时模型、信息架构与按键绑定
- [harness-trace-learning-phase2.md](./harness-trace-learning-phase2.md)：Trace 学习与基于 playbook 的引导

## 遗留规格与迁移状态

历史设计材料仍然存在于 `.kiro/specs/` 下，但它们并非自动具有权威性。请继续将本页作为经过策展的入口，而不要把原始归档当作真理之源。

<details>
<summary>遗留规格清单</summary>

| 遗留规格 | 范围 | 当前处理方式 |
|---|---|---|
| `.kiro/specs/docker-agent-execution/design.md` | 基于 Docker 的 ACP agent 执行架构 | 仅建立索引 |
| `.kiro/specs/docker-agent-execution/requirements.md` | Docker agent 执行需求 | 仅建立索引 |
| `.kiro/specs/docker-agent-execution/tasks.md` | Docker agent 执行任务分解 | 仅建立索引 |
| `.kiro/specs/kanban-workspace-repository/requirements.md` | 看板的工作区仓库需求 | 仅建立索引 |
| `.kiro/specs/playwright-page-snapshots/requirements.md` | 页面快照需求 | 仅建立索引 |
| `.kiro/specs/workspace-centric-redesign/design.md` | 以工作区为先的重新设计架构 | 仅建立索引 |
| `.kiro/specs/workspace-centric-redesign/requirements.md` | 以工作区为先的重新设计需求 | 仅建立索引 |
| `.kiro/specs/workspace-centric-redesign/tasks.md` | 以工作区为先的重新设计任务分解 | 仅建立索引 |

</details>

## 策展规则

- 仅从 `.kiro/specs/` 迁移经过审阅、仍然相关的知识。
- 不要将大型历史规格逐字拷贝进 `docs/`，除非它们正在被积极地规范化。
- 当某份遗留规格成为权威时，在此处创建一份聚焦的文档，并以简短的出处说明链接回源文件。
- 优先采用一份权威文档加指针的方式，而不是会发生漂移的并行副本。

## 相关文档

- [架构](/ARCHITECTURE)
- [架构决策记录](/adr)
- [产品规格](/product-specs/FEATURE_TREE)
- [开发者指南](/developer-guide)
