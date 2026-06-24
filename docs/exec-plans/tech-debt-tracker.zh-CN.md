# 技术债务追踪表

本文件用于追踪那些应当被有计划地削减、而不是反复重新发现的横切性债务。

## 如何使用本文件

- 添加那些跨越多个模块、计划或发布版本的债务
- 在有相关 issue、事故记录或 PR 时附上链接
- 优先写出具体的债务陈述，而非含糊的不满
- 一旦债务被偿还或重新定义，就移除或重写对应条目

## 当前初始条目

| 领域 | 债务 | 证据 | 建议的下一步 |
|---|---|---|---|
| 文档架构 | 持久性知识分散在 `docs/` 和 `.kiro/specs/` 之间 | Issue `#85`，本地同步记录见 `docs/issues/2026-03-08-gh-85-readability-agent-first-knowledge-architecture-repository-as-system-of-r.md` | 逐步将高价值的 specs 规范化迁移到 `docs/design-docs/` |
| 仓库可读性 | `docs/references/` 尚不存在，因此面向 Agent 的依赖参考仍然散落各处 | Issue `#85` | 从 ACP、Tauri 和 Drizzle 等高频参考开始着手 |
| 质量可见性 | 尚不存在规范的 `docs/QUALITY_SCORE.md` | Issue `#85` | 在构建自动化之前，先定义一份轻量级的手工评分卡 |
