# Tech Debt Tracker

This file tracks cross-cutting debt that should be reduced deliberately instead of rediscovered repeatedly.

## How To Use This File

- add debt that spans multiple modules, plans, or releases
- link to the relevant issue, incident note, or PR when available
- prefer concrete debt statements over vague dissatisfaction
- remove or rewrite entries once the debt is paid down or reframed

## Current Seed Items

| Area | Debt | Evidence | Suggested Next Move |
|---|---|---|---|
| Documentation architecture | Durable knowledge is split between `docs/` and `.kiro/specs/` | Issue `#85`, local sync note in `docs/issues/2026-03-08-gh-85-readability-agent-first-knowledge-architecture-repository-as-system-of-r.md` | Normalize high-value specs into `docs/design-docs/` incrementally |
| Repository readability | `docs/references/` does not exist yet, so agent-facing dependency references are still scattered | Issue `#85` | Start with high-frequency references for ACP, Tauri, and Drizzle |
| Quality visibility | No canonical `docs/QUALITY_SCORE.md` exists yet | Issue `#85` | Define a lightweight manual scorecard before building automation |
| Backend parity | 桌面后端（crates/routa-server）待对齐 configOptions：网页版已缓存 ACP configOptions、支持 session/set_config_option、在 acp_sessions 存 `reasoning_effort`、恢复时重放模型和档位，并提供 `/api/sessions/{id}/config-options` 与 `/api/providers/{id}/config-options`；Rust 后端都还没有。看板卡 c6251392 新增的看板步骤 `model`/`reasoningEffort`、任务 `assignedModel`/`assignedReasoningEffort`（tasks 表 `assigned_model`/`assigned_reasoning_effort` 列）和派施工者时传给 session/new 的模型与档位，也待 Rust 后端对齐；2026-10-23 网页版新增的看板施工者默认模型（`GET/PUT /api/kanban/model-tiers`，`~/.routa/kanban-model-tiers.json`）同样待 Rust 后端对齐 | Kanban 卡 adaf3d03；`src/core/acp/config-options.ts`、`session-config-apply.ts`、`session-config-service.ts`、`provider-config-probe.ts` | 在 routa-server 加 reasoning_effort 列和同形接口；复用 `drizzle-sqlite/0016` 迁移的语义，保持两端 API 形状一致 |
| Backend parity | 桌面后端（crates/routa-server）待对齐 provider 同步检查：网页版 2026-10-25 起在 session/new 建会话前检查静态 preset 命令是否存在，不可用返回 JSON-RPC -32002（`Provider "<id>" is unavailable: <命令> is not installed or not in PATH`），`_providers/list` 与 `/api/providers?check=true` 返回 `unavailableReason`；Rust 的 `crates/routa-server/src/api/acp_routes.rs`（session/new）和 `providers.rs` 都还没有。前端 unavailableReason 是可选字段，在 Rust 后端上退回显示 description | Kanban 卡 f1bc30c7（复盘 L298）；`src/core/acp/provider-availability.ts`、`src/app/api/acp/acp-session-create.ts` | 在 routa-server 加同一判定（resolve command + which），session/new 同步返回 -32002，列表接口补 unavailableReason |
