# Harness Monitor 以运行（Run）为中心的优先级

## 目标

将 `crates/harness-monitor` 从一个仓库本地的观察者转变为以运行（Run）为中心的操作员控制台，使其与 `Routa Harness Architecture v1` 中近期的方向保持一致。

本计划有意不作为完整的 Harness Core 路线图。它聚焦于应当首先演进到 `harness-monitor` 中的那一部分能力。

## 本计划存在的原因

`/Users/phodal/Downloads/routa-harness-architecture-v1.md` 中的架构草案给出了清晰的区分：

- `Harness Monitor` 是实时操作员控制台
- `Routa Harness Core` 是控制平面

如今 `harness-monitor` 在以下方面已经很强：

- 通过 Hook、进程检测和脏文件扫描进行观察
- 文件归属判定以及未知/冲突的暴露
- 通过面向 Entrix 的适应度函数面板进行可维护性评估

但当前的产品形态仍更接近会话/文件监控器，而非以运行为中心的 Harness 控制台。如果我们继续孤立地优化 `Agents View`，只会提升可见性，却不会提升控制能力。

因此近期的优先级是：

1. 让 `Runs` 成为主要的操作单元
2. 把 `Agents` 视为运行的一种信号来源，而不是主要的产品对象
3. 将评估、审批与证据附加到运行上
4. 在同一操作员流程中暴露 worktree 与编排状态

## 输入来源

- `/Users/phodal/Downloads/routa-harness-architecture-v1.md`
- [docs/ARCHITECTURE.md](../../ARCHITECTURE.md)
- [docs/fitness/README.md](../../fitness/README.md)
- [docs/fitness/harness-fluency.profile.agent_orchestrator.yaml](../../fitness/harness-fluency.profile.agent_orchestrator.yaml)
- [docs/design-docs/agentwatch-tui.md](../../design-docs/agentwatch-tui.md)

相关的仓库内领域脚手架已经存在于：

- [crates/harness-monitor/src/domain/task.rs](../../../crates/harness-monitor/src/domain/task.rs)
- [crates/harness-monitor/src/domain/run.rs](../../../crates/harness-monitor/src/domain/run.rs)
- [crates/harness-monitor/src/domain/workspace.rs](../../../crates/harness-monitor/src/domain/workspace.rs)
- [crates/harness-monitor/src/domain/evidence.rs](../../../crates/harness-monitor/src/domain/evidence.rs)
- [crates/harness-monitor/src/domain/policy.rs](../../../crates/harness-monitor/src/domain/policy.rs)
- [crates/harness-monitor/src/domain/eval.rs](../../../crates/harness-monitor/src/domain/eval.rs)
- [crates/harness-monitor/src/domain/events.rs](../../../crates/harness-monitor/src/domain/events.rs)

## 优先级判断

### P0：以运行为中心的操作员模型

这是接下来若干次迭代的主要优先级。

范围内：

- 让 `Run / Task / Workspace / Evidence` 成为 TUI 中可见的运行时模型
- 稳定非托管运行，使得外部的 `codex` / `claude` / `cursor` 进程即便在 Hook 覆盖不完整时也能作为运行显示出来
- 将 worktree 与仓库本地的工作区状态附加到每个运行上
- 将运行状态展示为操作员状态机，而不仅是 `active / idle / unknown`

为什么这是首位：

- 架构草案将这些定义为一等对象
- 仓库已在 `crates/harness-monitor/src/domain/` 中开始对它们建模
- 没有这一转变，策略、证据、评估与编排都无处可以连贯地附着

### P0：将非托管接入（Unmanaged Attach）作为一等能力

这是当前最重要的执行模式需求。

范围内：

- 在 Hook 缺失或不完整时，将仓库本地检测到的 Agent 附加到运行上
- 当归属判定置信度不足时，从进程检测合成回退性的非托管运行
- 在 UI 中区分真正由 Hook 支撑的运行与合成的回退运行
- 保持未知/冲突的归属可见，而不是用虚假的确定性来掩盖歧义

为什么这是首位：

- 当前的用户工作流已经依赖于外部启动的 Agent
- `Routa Harness Architecture v1` 明确将非托管模式视为一种有效的长期模式
- 托管式 runner 可以稍后再做，但控制台现在就必须解释正在发生什么

### P0：运行作用域的评估、证据与审批

这是从监控器迈向 Harness 控制台的关键一步。

范围内：

- 将快速/完整评估状态作为运行详情的一部分展示，而非孤立的、仅含适应度函数的界面
- 表示运行得以继续所需的证据
- 在运行详情中暴露阻断性的策略决策与审批检查点
- 显示运行是被硬性门禁失败、缺失证据，还是显式审批所阻断

为什么这是首位：

- 架构草案将 `Policy Plane` 与 `Evaluation Plane` 视为监控器与 Harness 之间的区别所在
- `docs/fitness/README.md` 已经定义了以证据驱动的校验规则手册
- 领域模型已经包含 `EffectClass`、`PolicyDecisionKind`、`EvidenceRequirement` 与 `EvalSnapshot`

### P1：工作区 / worktree 生命周期

这应在运行模型稳定后立即跟进。

范围内：

- 显示某个运行拥有或附加到哪个工作区或 worktree
- 暴露诸如 `provisioning`、`ready`、`dirty`、`validated`、`archived` 等工作区状态
- 在运行详情中展示漂移、完整性告警与恢复提示
- 让操作员能够判断某个运行是否可以安全地继续、重放或丢弃

为什么这是下一步：

- Routa 在 Web 端与桌面端都是工作区优先（workspace-first）
- worktree 生命周期是架构不变式的一部分，而非仅仅是 UI 层面的关注点
- 没有可见的工作区模型，托管模式就无法被清晰地理解

### P1：多 Agent 角色与交接可见性

这比一个更丰富的独立 Agents 面板更重要。

范围内：

- 使用现有的 `Role` 模型展示运行角色：`planner`、`builder`、`reviewer`、`fixer`、`release`、`caretaker`
- 展示运行之间的交接摘要
- 暴露未解决的问题与建议的后续操作
- 在可能时，按任务或执行链对相关运行进行分组

为什么这很重要：

- 架构草案将编排定义为基于角色的流程，而不仅仅是并发的会话
- 对操作员而言，下一个有用的问题不是「存在多少个 Agent？」，而是「谁负责下一步？」

### P2：托管执行封套（Managed Execution Envelope）

这属于路线图的一部分，但不是 `harness-monitor` 的首批交付目标。

后续范围内：

- 从监控器中启动运行
- 隔离环境、密钥作用域、工具允许列表、网络策略，以及时间/token 预算
- 暂停、恢复、重放，以及预检（preflight）策略评估

为什么这不是首位：

- 当前的用户价值缺口并非缺少启动器，而是缺少一个针对已经运行中的 Agent 的连贯运行控制台
- 在托管模式真正具备运维价值之前，非托管模式必须先值得信赖

### P2：交付循环与运行时修复

这很重要，但依赖于更早期的控制平面工作。

后续范围内：

- PR 开启、合并、部署、回滚，以及运行时监视集成
- 红灯修复（red-fix）与熵减循环
- 触发后续任务或清理操作的运行时异常界面

为什么这是后续：

- 这些操作需要成熟的策略、证据与运行身份标识
- 否则它们会沦为孤立的按钮，缺乏可靠的状态语义

## 这对 UI 意味着什么

推荐的信息层级为：

1. `Runs` 作为主要的导航列表
2. `Run Details` 作为主要的操作员窗格
3. `Files` 作为从属的证据与归属视图
4. `Agents` 作为辅助的信号与诊断视图
5. `Fitness` 作为运行作用域的证据状态，而非独立的评分卡

实际影响：

- 不要把 `Agents View` 当作创造价值的主要场所
- 将更多操作上下文移入 `Runs`
- 使用 Agents 面板来解释来源、进程健康状况以及匹配歧义

## 近期实现步骤

### 步骤 1：完成非托管运行回退

目标：
- 确保仓库本地检测到的 Agent 即便没有匹配的、由 Hook 支撑的会话，也能出现在 `Runs` 中

实现重点：
- 由未匹配的检测到的 Agent 生成合成回退运行项
- 为 `hook-backed` 与 `process-scan` 来源提供清晰的 UI 标签
- 在匹配存在歧义时不进行虚假归属

验证：
- 针对未匹配 Agent 回退的状态测试
- 针对运行列表与运行详情的 TUI 快照覆盖

### 步骤 2：将运行详情扩展为操作员状态

目标：
- 让运行详情成为操作员理解当前状态、来源、最近操作、工作区以及阻断原因的场所

实现重点：
- 来源、模式、角色、工作区/worktree 路径、最近的工具/事件，以及阻断原因
- 为 `executing`、`evaluating`、`awaiting_approval`、`failed`、`replayed` 提供摘要标签

验证：
- 针对紧凑/完整布局的快照测试
- 针对状态映射与排序/过滤行为的状态测试

### 步骤 3：将评估与证据附加到运行上

目标：
- 在运行可以继续之前，展示已有哪些证据以及仍缺失哪些证据

实现重点：
- 在运行详情中提供 `EvalSnapshot` 摘要
- 证据需求列表
- 针对硬性门禁、评分门禁或缺失产物的阻断状态

验证：
- 针对阻断/就绪逻辑的单元测试
- 针对健康运行与被阻断运行的快照测试

### 步骤 4：暴露策略与审批检查点

目标：
- 让副作用约束在操作员流程中可见

实现重点：
- 展示 effect class
- 展示当前的策略决策
- 展示审批是必需、已授予，还是处于阻断状态

验证：
- 围绕策略决策渲染与阻断语义的单元测试

### 步骤 5：新增工作区与交接视图

目标：
- 将运行执行与工作区生命周期及多 Agent 流程连接起来

实现重点：
- 在运行详情中提供工作区摘要
- 相关运行之间的交接摘要
- 未解决问题列表与后续操作列表

验证：
- 针对工作区状态摘要的单元测试
- 针对交接信息丰富的运行的快照覆盖

## 本计划明确不做的事项

- 从第一天起就围绕完整的托管运行时重新设计整个 TUI
- 在 `harness-monitor` 内部实现整套 `ContextPack` 与仓库记忆系统
- 在运行模型稳定之前用新的评估引擎替换 Entrix
- 把 Agents 面板变成主要的产品界面

## 退出标准

当满足以下条件时，本计划即为成功：

- `Runs` 能够可靠地表示由 Hook 支撑的执行与仓库本地的非托管执行
- 操作员能够判断某个运行为何被阻断、存在风险或已可继续
- worktree 与评估状态可以从运行流程中看到
- Agents 面板成为一个辅助性的诊断视图，而非主要的控制界面
- 未来的托管模式工作能够附着到一个已经清晰可读的运行/任务/工作区/证据模型上
