# ADR 0003：工作区优先作用域

- Status: accepted
- Date: 2026-02-25
- Derived from: [design-doc](../design-docs/workspace-centric-redesign.md), [issue #20](https://github.com/phodal/routa/issues/20)

## 背景

早期版本对会话、任务和看板使用隐式的全局作用域。随着产品的发展，这带来了以下问题：
- 来自不同项目的会话混杂在同一个列表中
- 缺乏清晰的边界来界定哪个 Agent 配置或专家适用于何处
- MCP 工具作用域含糊不清（"git status" 指向的是哪个仓库？）

## 决策

工作区是顶层的协调边界。所有领域实体都以工作区为作用域：

- 会话、任务、笔记、看板、代码库、worktree、记忆和计划任务都归属于某个工作区。
- API 路由必须携带显式的工作区上下文（路径参数或查询参数），除非它们是有意设计的引导流程。
- MCP 工具在执行前会先解析工作区上下文。
- UI 导航以工作区为先：用户先选择一个工作区，再深入到其资源。

`"default"` 工作区作为过渡性脚手架存在，用于尚未完全迁移的路径。它并不是目标领域模型。

## 影响

- 新的 API 端点必须接受工作区作用域。没有显式作用域的端点被视为不完整。
- 存储实现在 CRUD 操作中将 `workspaceId` 作为必需参数接收。
- `RoutaSystem`（TypeScript）和 `AppState`（Rust）都会通过各自的服务层传递工作区上下文。
- 看板自动化、后台任务和计划运行都从其父看板/工作流继承工作区作用域。

## 代码引用

- `src/core/routa-system.ts` — 感知工作区的存储装配
- `crates/routa-core/src/state.rs` — 感知工作区的 Rust 状态
- `docs/design-docs/workspace-centric-redesign.md` — 完整的重新设计状态
- `src/core/models/workspace.ts` — 工作区模型
