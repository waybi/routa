# Kanban Write-Tool Lightweight Ack Returns

## Goal

Stop `update_card` / `move_card` MCP tool results from echoing the full card (including the entire accumulated comment history) back into the calling agent's LLM context. Write-type tools return a lightweight ack; agents that need fresh state call `get_task` explicitly.

## Why This Plan Exists

Measured on a real session (`8046bd3e-44b9-4f21-851a-fb4c9cc107e9`, card `7e93558c` "多 worker 环境下验证常驻通路与多轮会话的跨进程一致性"):

- Two `update_card` calls each returned **76 KB** (the full card with 7 accumulated review notes).
- Each echo added **+20–21K tokens** to the agent context (usage_update evidence: 85,483 → 106,572 and 110,261 → 130,612).
- Card comments are append-only (`appendTaskComment`), so the echo grows monotonically: the older the card, the fatter every subsequent write becomes.
- The two 76 KB `tool_call_update` entries are also the largest items in the persisted session history, inflating the `/transcript` payload (414 KB total; these two account for ~150 KB).

The repo already has the correct precedent: `update_task` returns `{ taskId, version, updatedFields, updatedAt, warnings }` (`src/core/tools/agent-tools.ts:1002-1010`). `update_card` / `move_card` are the outliers.

## Scope

In scope:
- `update_card` and `move_card` MCP tool result shapes, on both backends.
- Tool catalog descriptions for these two tools.
- Tests locking the new ack shapes, plus cross-backend shape parity assertions.

Out of scope (tracked as follow-up candidates, not in this plan):
- `get_task` comment pagination / field selection (read tools legitimately return state; the old-card `get_task` payload is ~33K chars and is a second-order cost).
- A global tool-result size cap in `formatResult` / `tool_result_json` (defense in depth).
- `create_card` / `decompose_tasks` echoes (new cards carry no comment history; low value).
- Any change to REST APIs, RPC methods, or UI data flows.

## Current Evidence (file/line map)

| Surface | Location | Current behavior |
|---|---|---|
| Next `updateCard` | `src/core/tools/kanban-tools.ts:496` | `successResult(this.taskToCard(task))` — full card |
| Next `moveCard` | `src/core/tools/kanban-tools.ts:438` | same full-card echo |
| Next `taskToCard` | `src/core/tools/kanban-tools.ts:927` | includes `comment` (full blob) **and** `comments` (same content, structured) |
| Next MCP consumers | `src/core/mcp/mcp-tool-executor.ts:726`, `src/core/mcp/routa-mcp-tool-manager.ts:1227` | pass-through wrappers; only consumers of these two methods (verified by grep) |
| Rust MCP projection | `crates/routa-server/src/api/mcp_routes/tool_executor/events_kanban.rs:155,173` | extracts `result.card` from RPC and echoes it verbatim |
| Rust core RPC | `crates/routa-core/src/rpc/methods/kanban/cards.rs:249` | `UpdateCardResult { card: task_to_card(&task) }` — **has non-MCP consumers (CLI `routa-cli/src/commands/kanban.rs`, RPC clients)** |
| Rust tool catalog | `crates/routa-server/src/api/mcp_routes/tool_catalog.rs:422` | `update_card` description |
| Next tests | `src/core/tools/__tests__/kanban-tools.test.ts` (5 `updateCard` + 8 `moveCard` call sites) | mostly error-path assertions; success-shape assertions must be reviewed |

## Design

### Contract (identical on both backends)

```jsonc
// update_card success result
{
  "success": true,
  "data": {
    "id": "<cardId>",
    "updatedFields": ["comment"],        // derived from which params were provided
    "updatedAt": "2026-09-21T07:01:08.289Z"
  }
}

// move_card success result
{
  "success": true,
  "data": {
    "id": "<cardId>",
    "columnId": "done",
    "position": 2,
    "status": "DONE"
  }
}
```

Decisions:
- No `comment`/`comments`/`description` echo of any kind. The agent composed those arguments; echoing them is zero-information.
- No `commentCount`: the Rust task model stores `comment` as a single string while Next also keeps a structured `comments` array — a count cannot be derived identically on both sides, and shape parity wins.
- No `fromColumnId` in `move_card`: the Rust MCP projection layer only sees the post-move card, so the field cannot be produced there without touching the core RPC (out of scope).
- Error paths are unchanged (gate errors, frozen-description errors, not-found).

### Layering

- **Next**: change the returns inside `KanbanTools.updateCard` / `KanbanTools.moveCard` directly. Verified safe: their only consumers are the two MCP wrappers.
- **Rust**: do **not** touch `kanban.updateCard` / `kanban.moveCard` RPC methods or `UpdateCardResult` (CLI and RPC clients need the full card). Trim in the MCP projection layer only: `events_kanban.rs` builds the ack from the returned card's `id`/`columnId`/`position`/`status`/`updatedAt` plus the presence of args (`updatedFields`).

### Tool descriptions

Append to both catalogs (Next: `routa-mcp-tool-manager.ts` register blocks + `mcp-tool-executor.ts` tool definitions; Rust: `tool_catalog.rs:422` and the move_card entry):

> Returns a lightweight ack (id, updatedFields, updatedAt). It does NOT echo the card. Call `get_task` if you need the updated card state.

## Pre-flight Dependency Sweep (step 1 — done)

| Consumer surface | Finding | Verdict |
|---|---|---|
| `resources/specialists/**` (113 matches for `update_card`/`move_card`) | All matches are prompt instructions telling agents to *call* the tools. No prompt parses or references fields of the returned card. | Safe |
| Next code (`grep updateCard\|moveCard src/ --include=*.ts` excluding tests/definition) | Only `src/core/mcp/mcp-tool-executor.ts:717,726` and `src/core/mcp/routa-mcp-tool-manager.ts:1199,1227`; both are pass-through wrappers (`toMcpResult(result)` / `formatResult(...)`). Unrelated hits are `removeCardJob` (session queue). | Safe |
| Rust CLI `crates/routa-cli/src/commands/kanban.rs:156,187` | **Actively consumes `result.card`** via `format_card_text(card, ...)` to render terminal output, through `call_rpc("kanban.updateCard"/"kanban.moveCard")` — i.e. the core RPC path, not the MCP path. | Confirms the layering decision: core RPC must keep returning the full card; trim only in the MCP projection. |
| Rust `tasks_automation.rs:134,214` | Prompt text only. | Safe |

No blocking consumer found. Proceeding with the MCP-projection-only design as written.

## Planned Steps

1. ~~**Pre-flight dependency sweep**~~ — done, see section above.
2. **Next backend (commit 1)**:
   - Add shape tests locking the new ack contract (success paths) in `kanban-tools.test.ts`; review the 13 existing call sites and update any success-shape assertions.
   - Change `kanban-tools.ts:496` and `:438` returns.
   - Update the two Next tool descriptions.
   - `npx vitest run src/core/tools/__tests__/kanban-tools.test.ts src/core/mcp/__tests__/`
3. **Rust backend (commit 2)**:
   - Project ack in `events_kanban.rs` `update_card` / `move_card` branches; leave RPC untouched.
   - Update `tool_catalog.rs` descriptions.
   - Extend Rust MCP tool executor tests (or add) asserting the ack shape, mirroring the Next shape test field-for-field.
   - `cargo test -p routa-server`
4. **Validation (with commit 2 or a small commit 3)**:
   - `entrix run --tier normal` (behavior change in shared modules / MCP surface).
   - Manual probe: run one Kanban agent turn that comments on an old fat card; confirm the persisted `tool_call_update` for `update_card` is < 1 KB and the usage_update delta no longer jumps ~20K tokens.

## Exit Criteria

- `update_card` / `move_card` MCP results are the documented ack on both backends, byte-shape-identical for the same operation.
- New sessions on comment-heavy cards no longer show multi-KB `tool_call_update` entries for these tools.
- All existing gate/error-path tests pass unchanged; `entrix run --tier normal` passes.

## Risks

| Risk | Mitigation |
|---|---|
| An agent prompt/specialist flow relies on the echoed card state | Pre-flight sweep (step 1); tool description explicitly points to `get_task` |
| Backend shape drift over time | Mirrored shape tests on both sides; same field list asserted |
| Agents start calling `get_task` after every write, re-adding tokens | Acceptable: it becomes an explicit, observable choice instead of an unconditional 76 KB tax; revisit with `get_task` pagination follow-up if observed |

## Rollback

Both changes are single-function return-shape edits behind stable tool names; reverting the two commits restores the previous behavior with no data migration.

## Measured Baseline (for before/after comparison)

- Session `8046bd3e-44b9-4f21-851a-fb4c9cc107e9`: history events [42] and [67] = 76,292 / 76,421 bytes (`update_card` results); usage 58,750 → 130,612 tokens across the session; the "放行" round paid +20,351 tokens for one comment write.
- Repro: `curl -s localhost:3000/api/sessions/8046bd3e-44b9-4f21-851a-fb4c9cc107e9/history` and inspect `tool_call_update` sizes + `usage_update.used` deltas.
