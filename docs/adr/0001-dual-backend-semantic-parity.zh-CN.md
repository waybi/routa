# ADR 0001：双后端语义对等

- Status: accepted
- Date: 2026-02-15

## Context

Routa.js 同时以 Web 应用（Next.js）和桌面端应用（Tauri + Rust/Axum）的形式发布。项目早期就提出了一个问题：这两者究竟应该是两个共享 UI 的独立产品，还是一个产品的两个部署形态？

两个独立产品能让二者更快地各自演进，但随着时间推移会有领域模型漂移的风险。而采用共享语义的方式则会约束两个后端，却能让用户和 Agent 保持在同一套心智模型中。

## Decision

Web 端与桌面端是同一个产品的两个运行时形态。它们必须：

1. 共享同一套领域模型词汇（workspace、session、task、kanban board、specialist、worktree 等）
2. 暴露相同的 API 形态，由仓库根目录的 `api-contract.yaml` 统一约束
3. 在 CI 中运行 API 契约对等测试（`npm run api:test:nextjs` 与 `npm run api:test:rust` 对比）

TypeScript 的装配点是 `src/core/routa-system.ts`。Rust 的装配点是 `crates/routa-core/src/state.rs`。两者接入的是同一组 store、事件总线和领域服务。

## Consequences

- 新的领域概念必须在两个后端中都引入之后，才能被视为已交付。
- `api-contract.yaml` 是 API 形态的唯一真实来源。Next.js 与 Axum 中的路由处理器必须保持一致。
- 存储可以不同（Web 端用 Postgres，桌面端用 SQLite），但 store 接口和领域语义不得不同。
- `api_contract` 适应度函数维度通过自动化对等检查来强制执行这一点。

## Code References

- `api-contract.yaml` — 共享 API 契约
- `src/core/routa-system.ts` — TypeScript 系统工厂
- `crates/routa-core/src/state.rs` — Rust 系统工厂
- `docs/fitness/api-contract.md` — 对等测试规范
