# 工作区为中心的规范化计划

## 目标

完成历史上「工作区为中心」重新设计的文档迁移，并以该迁移为驱动力，清理剩余的过渡逻辑。

## 本计划存在的原因

该仓库已经实现了工作区优先模型的大部分内容，但对该模型的持久化描述被困在 `.kiro/specs/` 中。与此同时，部分运行时路径仍然把 `default` 当作一个普通的长期工作区，而不是一个引导（bootstrap）产物来对待。

本计划保持迁移过程的增量化和证据驱动。

## 范围

范围内：
- 在 `docs/design-docs/` 中将「工作区为中心」的重新设计规范化为权威文档
- 识别剩余的 `default` 回退行为
- 将宽泛的历史任务转化为有边界的清理步骤

范围外：
- 重写所有历史规范
- 在一个 PR 中移除每一处默认工作区假设
- 重新记录已经稳定、且在别处已有覆盖的产品界面

## 当前证据

- 工作区页面、代码库路由以及工作区切换器 UI 均已实现。
- 过渡性的默认回退仍存在于：
  - `src/app/api/tasks/route.ts`
  - `src/app/api/background-tasks/route.ts`
  - `src/app/api/acp/route.ts`
  - `crates/routa-server/src/lib.rs`
  - `crates/routa-cli/src/commands/prompt.rs`

## 计划步骤

1. 落地权威设计文档及其出处链接。
2. 枚举所有剩余的稳态 `default` 工作区回退。
3. 按子系统将清理拆分为实现规模的 issue 或计划：
   - Next.js API 回退
   - Rust 服务端引导/运行时分离
   - CLI 和 MCP 的默认作用域假设
4. 在清理落地处，为显式工作区要求添加或扩展回归覆盖。
5. 一旦权威文档覆盖了必要的架构和活跃的清理路径，便弃用或降级旧的 `.kiro/specs/workspace-centric-redesign/*` 文件。

## 退出标准

- `docs/design-docs/workspace-centric-redesign.md` 成为该主题显而易见的入口。
- 剩余的 `default` 逻辑被作为显式的清理工作来跟踪，而不是隐藏在遗留规范中。
- 新贡献者无需先阅读 `.kiro/specs/workspace-centric-redesign/*` 即可理解当前架构。
