# ADR 0006: 编排外壳模式（Orchestration Shell Pattern）

- Status: accepted
- Date: 2026-03-01

## Context

随着代码库的增长，一些文件积累了混杂的关注点：JSX 布局与副作用、流式逻辑、会话管理以及队列编排交织在一起。按照「组件 vs 工具函数」来拆分，只会产出同样庞大的大杂烩 `utils.ts` 文件。

其失败模式是：一个超大文件被一个超大 hook 或一个超大 utils 模块所取代。

## Decision

复杂文件必须遵循 **编排外壳 + 领域 hooks（orchestration shell + domain hooks）** 结构：

- **编排外壳** 是一个轻量的顶层入口，负责路由流程并协调各个模块。它本身不承载实现的体量。
- **领域 hooks/模块** 包含实际的逻辑，每一个都聚焦于一条稳定的工作流边界（例如：bootstrap、导航、任务执行、流式同步）。

抽取顺序：
1. 首先按工作流分支拆分（例如：会话创建 vs. prompt 流式传输 vs. provider 分发）
2. 仅在工作流分支稳定之后，再抽取共享 helper
3. 当真正的体量集中在一两条协议分支上时，切勿一开始就建立一个通用的 `utils` 文件

这同样适用于：
- 将布局与副作用混在一起的 React 组件
- 将 CRUD 与流式传输或编排混在一起的 API 路由处理器
- 将事件处理与队列管理混在一起的看板自动化

## Consequences

- 在重构一个行为密集的文件之前，先添加特征化测试（characterization tests），以锁定当前的路由、生命周期、持久化和恢复行为。
- 优先一次抽取一条工作流边界，而非一次性拆分所有内容。
- `entrix` 中的 `code_quality` 适应度函数维度强制执行文件大小预算，使该模式在机制上成为必需。
- `entrix analyze long-file` 通过结合文件大小与 git 变更频率来识别抽取候选项。

## Code References

- `AGENTS.md` § Coding Standards — 规范性强制约束
- `docs/REFACTOR.md` — 抽取优先级信号与长文件分诊工作流
- `docs/REFACTOR.md` — 长文件分诊的重构 playbook
