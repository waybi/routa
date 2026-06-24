---
title: "团队自动化能力已存在于 specialist/CLI 中，但产品在工作区 UI 中没有清晰的团队入口或边界"
date: "2026-03-20"
status: resolved
resolved_at: "2026-03-22"
severity: medium
area: "ui"
tags: ["team", "automation", "specialist", "workspace", "navigation", "information-architecture", "product"]
reported_by: "codex"
related_issues:
  - "2026-03-17-design-system-unified-desktop-sidebar-theme-routing.md"
  - "2026-03-19-homepage-kanban-entry-surface-fragmentation.md"
  - "2026-03-19-specialist-resource-layout-drift-and-loader-divergence.md"
  - "https://github.com/phodal/routa/issues/205"
github_issue: 205
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/205"
---

# 团队自动化能力已存在于 specialist/CLI 中，但产品在工作区 UI 中没有清晰的团队入口或边界

## 发生了什么

运行时的 specialist 目录中已经存在 `team-*` specialist，包括一个专门的 `team-agent-lead` 协调者，它被明确设计为接收一项需求、对其进行拆解、委派给特定角色的成员，并验证完成情况。

同一个仓库中也已经包含一个 CLI 层级的 `routa team` 流程，它会：

- 发现 `team-*` 成员
- 构建团队名册（roster）
- 启动一个团队 lead 会话
- 流式呈现交互式的协调运行过程

在 Web 端，底层的 ACP/会话流水线已经能够执行同一个 specialist，因为会话创建接受 `specialistId`，会解析 specialist 的角色/Provider/模型，并在解析出的角色为 `ROUTA` 时注册编排器（orchestrator）。

然而，工作区 UI 仍然没有专门的团队入口、团队页面或面向团队的运行时界面。实际上，团队模式只能通过间接方式触达：

- 从 Home 输入框中选择一个自定义 specialist
- 事先知道正确的 specialist ID
- 把由此产生的会话当作一个通用的 ROUTA 会话

这意味着该能力在技术上存在，但并不是一个用户能够发现或加以理解的产品概念。

## 预期行为

如果团队被定位为一等公民能力，产品就应当让这一意图变得清晰可见：

- 团队应当作为一个独立的工作区界面被发现，而不是隐藏在通用的自定义 specialist 选择之后
- 用户应当能够理解团队与普通 Routa 多 Agent 模式以及静态工作流之间的区别
- UI 应当将团队运行作为一个有意义的对象或界面来呈现，而不仅仅是与其他所有内容混在一起的通用会话
- 导航和信息架构应当体现团队究竟是一种核心运行模式、一个高级 specialist，还是仅仅是一个 CLI 功能

## 复现上下文

- 环境：两者皆有
- 触发条件：在考虑添加左侧导航的团队自动化入口时，审阅当前的 `resources/specialists/team`、桌面端导航、Home 输入框的 specialist 选择、ACP 会话创建、工作流 UI 以及现有的 CLI 团队流程

## 为什么可能出现这种情况

- 团队能力似乎是先从 specialist/资源侧和 CLI 侧成长起来的，而对应的工作区层级 UI 概念尚未被定义
- 当前 Web 产品围绕诸如 Overview、Kanban、Sessions、Traces 和 Settings 等页面来组织工作，但团队无法干净地映射到这些既有界面中的任何一个
- 当前的 specialist API 将 specialist 暴露为一个扁平列表，因此团队成员在运行时可见，但作为一个产品类别却不可见
- 会话/任务/Agent 数据足以运行协调者流程，但 UI 中没有显式的团队运行聚合体或团队专属的状态模型
- `workflow` 和 `team` 都代表自动化，但它们是实质上不同的概念：前者是一个静态的后台 DAG，后者是一种交互式的「主导并委派」运行模式

## 相关文件

- `resources/specialists/team/agent-lead.yaml`
- `resources/specialists/team/backend-dev.yaml`
- `resources/specialists/team/frontend-dev.yaml`
- `resources/specialists/team/qa.yaml`
- `resources/specialists/team/researcher.yaml`
- `src/core/specialists/specialist-file-loader.ts`
- `src/client/components/home-input.tsx`
- `src/app/api/acp/route.ts`
- `src/app/api/sessions/route.ts`
- `src/core/acp/http-session-store.ts`
- `src/client/components/desktop-sidebar.tsx`
- `src/client/components/desktop-app-shell.tsx`
- `src/client/components/workflow-panel.tsx`
- `src/core/workflows/workflow-executor.ts`
- `crates/routa-cli/src/commands/team.rs`

## 观察

- `team-agent-lead` 已经被编写为一个专门的协调者提示词，而不是一个通用的 specialist 变体；它直接命名了团队名册和协调规则。
- specialist 加载器已经支持诸如 `team/`、`review/` 和 `workflows/kanban/` 这样的分类目录，这意味着团队在结构上已经作为运行时资源存在，而不是一次性的提示词 hack。
- Home 输入框会加载所有 specialist，并允许用户将其中之一作为自定义 specialist 启动，这意味着团队在今天技术上已经可以从 UI 调用，但只能通过一条仅限专家的路径。
- ACP 会话创建已经会解析 `specialistId`，从 specialist 中推导出角色/Provider/模型，并为 `ROUTA` 注册一个编排器；这使得团队运行无需新的执行引擎即可成立。
- 会话存储已经记录了 `specialistId`，因此团队 lead 会话在运行时数据中是可区分的，但 `/api/sessions` 将它们视为普通会话，没有任何团队专属的框定。
- 桌面端左侧导航目前仅暴露 Home、Overview、Kanban、Traces 和 Settings；在两种桌面端 shell 实现中都没有团队界面。
- 现有的工作流 UI 是围绕 YAML 定义的后台执行和静态步骤图来组织的。该界面传达的是可重复的流水线，而不是交互式委派或团队监督。
- CLI 的 `routa team` 命令让团队感觉像是一等模式，而 Web UI 却让同样的能力显得无足轻重。这造成了跨界面的产品漂移。
- 从信息架构的角度看，尚未解决的问题不是团队能否运行，而是产品是否将团队视为：
  - 一个 specialist
  - 一种工作区运行模式
  - 一个可复用的工作流模板族
  - 还是一个拥有自身运行时对象的独立自动化界面

## 参考

- 已检索的本地历史记录：
  - `docs/issues/2026-03-17-design-system-unified-desktop-sidebar-theme-routing.md`
  - `docs/issues/2026-03-19-homepage-kanban-entry-surface-fragmentation.md`
  - `docs/issues/2026-03-19-specialist-resource-layout-drift-and-loader-divergence.md`

## 解决方案

该问题已在当前代码库中得到解决，且上游 GitHub issue 已关闭。

当前实现中的证据：

- `src/client/components/desktop-sidebar.tsx` 现在在工作区导航中暴露了一等的
  `Team` 入口。
- `src/app/workspace/[workspaceId]/team/page.tsx` 和
  `src/app/workspace/[workspaceId]/team/team-page-client.tsx` 提供了一个
  专门的团队启动界面，而不再将该能力隐藏在通用的
  specialist 选择之后。
- `src/app/workspace/[workspaceId]/team/[sessionId]/page.tsx` 及相关的
  团队运行组件为团队会话提供了一个专门的运行时界面。
- `src/client/utils/specialist-categories.ts` 和团队页面会从 specialist 目录中
  按结构筛选出团队 specialist，与产品层级的团队概念相匹配。
