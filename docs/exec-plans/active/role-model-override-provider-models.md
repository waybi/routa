# Role Model Override: Use Provider-Advertised Models

## Goal

Make the **Settings → 角色 → Model Override** field actually select the model an ACP provider runs, and let the user pick from the models the provider itself advertises (for DeepSeek Harness: the `model` config option returned by `session/new`) instead of typing a raw id or pre-defining an alias in the Models tab.

## Why This Plan Exists

The user asked (2026-09-23) to turn Model Override into a dropdown of "the models DSH already has configured", on the assumption that only the input widget is missing. Investigation shows the widget is the smallest part of the gap: for generic ACP providers, the override value never reaches the agent today.

Measured / read evidence:

- DSH advertises its models on every `session/new`. Snapshot `deepseek-harness/snapshots/acp/handshake/stdout.expected.jsonl:2` returns `configOptions: [{ id: "model", type: "select", currentValue: "[\"deepseek-official\",\"deepseek-v4-flash\"]", options: [ deepseek-v4-flash, deepseek-v4-pro ] }]`.
- DSH supports switching via `session/set_config_option` (`deepseek-harness/packages/acp/acp/README.zh.md:70`, handler at `packages/acp/acp/src/index.ts:339`).
- Routa discards that data: `src/core/acp/acp-process.ts:277-280` sends only `{ cwd, mcpServers }` and casts the result to `{ sessionId: string }`.
- `grep -rn "configOptions\|set_config_option" src` finds no sender; the only hit is a UI message-processor branch (`src/client/components/chat-panel/hooks/message-processor.ts:549`, `config_option_update`).
- DSH runs through that generic path: runtime log `/tmp/nextstart.log` shows `[AcpProcess:DeepSeek Harness] ...`.
- The existing model-listing endpoint only knows `opencode` via a CLI command (`src/app/api/providers/models/route.ts:24-33`); every other provider gets `"Provider does not support model listing"`.
- Only the Claude Code process path forwards a model (`src/core/acp/claude-code-process.ts:214`, `--model`), so Model Override is provider-dependent today.

Consequence: a pure UI dropdown would let the user "choose" `deepseek-v4-pro` while the session still runs DSH's default (`deepseek-v4-flash` in the snapshot). **Not verified at runtime** — no session was launched with an override during this investigation; the claim rests on the code path above.

## Decision

| Question | Decision | Reason |
|---|---|---|
| Just swap the text input for a `<select>`? | No | Cosmetic; value is not delivered to ACP providers (see evidence). |
| Source of the model list for ACP providers | `configOptions` (`id: "model"`) from `session/new` | Protocol-native, already implemented by DSH; no provider-specific CLI parsing. |
| How to apply the chosen model | `session/set_config_option` right after `session/new`, before first prompt | DSH supports it; keeps `session/new` params protocol-standard. |
| Widget shape | Combobox (choose **or** type), not a strict select | Providers that advertise nothing (or CLI-flag providers like Claude Code) still need free text; Models-tab aliases stay selectable. |
| Stored value | Provider's opaque option `value` (e.g. `["deepseek-official","deepseek-v4-pro"]`), display `name` | DSH option values are JSON-encoded pairs, not the display name. |
| Keep the Models tab? | Yes | Aliases also carry Base URL / API key for providers without their own connection config. |

## Constraints

- Web and desktop must keep the same semantics (`docs/ARCHITECTURE.md`); the Rust ACP path (`crates/routa-core/src/acp/`) needs the equivalent change or an explicit, tracked gap.
- The list is only known after a provider process is running. Settings can be opened before any session exists.
- A provider may return no `model` option, or reject `set_config_option`; session creation must not fail because of the override.
- UI strings must go through i18n.

## Current Evidence (file/line map)

| Surface | Location | Current behavior |
|---|---|---|
| ACP `session/new` | `src/core/acp/acp-process.ts:272-286` | sends `cwd`, `mcpServers`; keeps only `sessionId` |
| Session manager callers | `src/core/acp/acp-process-manager.ts:266,394` | `proc.newSession(cwd[, mcpServers])`, no model |
| Role override resolution (UI) | `src/app/workspace/[workspaceId]/sessions/[sessionId]/session-page-client.tsx:463-486` | computes `model`, passes to `acp.createSession(...)` |
| Model tier resolution (server) | `src/core/acp/agent-instance-factory.ts:11-16` | priority list documented for the Claude SDK adapter |
| Claude Code forwarding | `src/core/acp/claude-code-process.ts:214` | `--model <id>` |
| Model listing API | `src/app/api/providers/models/route.ts:24-33` | `opencode` only, via CLI |
| Model listing client | `src/client/acp-client.ts:352` | calls the API above |
| Role tab widget | `src/client/components/settings-panel.tsx:262-277` | `<input list=datalist>` fed only by Models-tab aliases |
| DSH advertises models | `deepseek-harness/packages/acp/acp/src/index.ts:226-230` | returns `{ sessionId, configOptions }` |
| DSH switches models | `deepseek-harness/packages/acp/acp/src/index.ts:339` | `session/set_config_option` |

## Design

```text
session/new (AcpProcess)
  └─ keep result.configOptions → cache per providerId (process memory, TTL)
       └─ GET /api/providers/models?provider=dsh
            ├─ cached configOptions.model.options → [{ value, name, group }]
            └─ fallback: existing CLI configs (opencode) / empty list

createSession(provider, model)
  └─ after session/new: if model && provider advertised a "model" option
       └─ session/set_config_option { configId: "model", value: model }
            └─ on error: log + keep default model, surface a warning event

Settings → 角色 → Model Override
  └─ combobox: [provider models] + [Models-tab aliases] + free text
```

Open design choice (to settle in step 1): when no DSH session has run yet, either (a) spawn a short-lived probe session to fetch `configOptions`, or (b) show "start a session once to load models" and rely on the cache. (b) is cheaper and has no side effects; (a) gives a better first-run experience.

## Implementation Steps

1. Characterization test: lock that `AcpProcess.newSession` currently ignores `configOptions` and never calls `set_config_option` (baseline).
2. `AcpProcess.newSession` returns / stores `configOptions`; add `setConfigOption(configId, value)`.
3. Provider-models cache + extend `GET /api/providers/models` to serve ACP-advertised options.
4. Apply override after `session/new` in the session-creation path; non-fatal on failure.
5. Rust parity (`crates/routa-core/src/acp/`) or a tracked gap in `docs/exec-plans/tech-debt-tracker.md`.
6. Role tab: combobox listing provider models + aliases + free text; i18n strings.
7. Register any new/changed endpoint in `api-contract.yaml`; run `npm run api:check`.

## Verification

```bash
# DSH advertises models (reference snapshot)
sed -n 2p ../deepseek-harness/snapshots/acp/handshake/stdout.expected.jsonl

# Baseline: no sender today (expect only the UI message-processor hit)
grep -rn "configOptions\|set_config_option" src

# After implementation
npx vitest run src/core/acp
curl -s 'http://localhost:3000/api/providers/models?provider=dsh'   # expect deepseek-v4-* options
entrix run --tier normal
```

Manual: set ROUTA → DeepSeek Harness, Model Override → `deepseek-v4-pro`, start a 多智能体 session, confirm the session's model (DSH `config_option_update` / usage) is `deepseek-v4-pro`, not the default.

## Risks

- Probe sessions (option a) cost a DSH process start and may create empty sessions; must be cleaned up.
- Cached list can go stale when the user edits DSH's model config; TTL + refresh button.
- `set_config_option` semantics differ per ACP agent; only apply when the provider advertised a `model` option.
- Kanban lane automation resolves providers server-side (`src/core/kanban/effective-task-automation.ts:109-119`) and does not read the role table; this plan does not change Kanban model selection.
