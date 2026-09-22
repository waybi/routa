# Rust/Axum 补齐 `/api/tasks/{id}/human-summary`（人话版摘要端点双后端对齐）

状态：已实现（2026-09-22，commit 15cff103）
日期：2026-09-22
来源：`docs/exec-plans/completed/card-detail-human-readable-tab.md`「未做」一节

## 要解决的问题

人话版 Tab 的摘要端点只在 Next.js 实现（`src/app/api/tasks/[taskId]/human-summary/route.ts`）。
桌面（Tauri + Axum，`crates/routa-server`）没有对应路由，`desktopAwareFetch` 落到 `http://127.0.0.1:3210` 后得到 404，Tab 下半部分显示「生成摘要失败: HTTP 404」；上半部分（程序解析）不受影响。

这违背 `AGENTS.md` 的约定：Web 与桌面必须保持相同的 API shape 与领域语义。

为什么门禁没拦住：`npm run api:check`（`scripts/fitness/check-api-parity.ts`）只强制 `api-contract.yaml` 里登记的端点双后端一致（当前 236/236）；未登记的端点归入「Extra in Next.js (not in contract)」警告，不算失败。本次两条路由正处于该警告列表（复跑 `npm run -s api:check | grep human-summary` 可见）。

## 现状（已核对）

| 项 | Next.js | Rust |
|---|---|---|
| 路由 | `GET/POST /api/tasks/[taskId]/human-summary` | 无（`crates/routa-server/src/api/tasks/handlers.rs:34-55` 路由表里没有） |
| 缓存 | 文件 `~/.routa/task-summaries/<taskId>.<lang>.json`，键=描述 sha256（`src/core/kanban/task-human-summary-store.ts`） | 无 |
| 事实解析 / lint / 提示词 | `src/core/kanban/task-human-summary.ts` | 无 |
| 模型调用 | `ai` SDK `generateText` + `resolveWorkspaceAgentConfig`（`WORKSPACE_AGENT_PROVIDER/MODEL`） | 已有 `AcpAgentCaller::call(&AgentCallConfig, prompt)`（`crates/routa-core/src/workflow/agent_caller.rs:12`），`review.rs:185-215` 是读取 `ANTHROPIC_*` 环境变量组装配置的现成例子 |
| 契约登记 | `api-contract.yaml` 未登记 | — |

## 方案

在 Rust 侧实现同形状端点，并把两条路由写进 `api-contract.yaml`，让 parity 门禁从此强制双端一致。

响应形状（与 Next.js 完全一致，客户端 `kanban-human-readable-panel.tsx` 不改）：

```text
{ taskId, descriptionHash, language: "zh-CN"|"en", record: TaskHumanSummaryRecord|null, stale: boolean, cached: boolean }
TaskHumanSummaryRecord = { taskId, descriptionHash, language, model, generatedAt, summary:{what,where,blockedNext,evidence:[{label,where}]}, lintHits:[] }
```

缓存文件格式与路径复用 Next.js 的（同一台机器上 Web 与桌面共享缓存，互相命中）。

## 实现步骤

1. `crates/routa-server/src/api/tasks/human_summary.rs`（新文件）
   - `hash_task_description(objective)`：`\r\n`→`\n`、trim、sha256 hex，与 TS `hashTaskDescription` 逐字节一致（对同一描述必须得到同一 hash，否则两端互相判 stale）。
   - `FileTaskHumanSummaryStore`：路径 `ROUTA_TASK_SUMMARY_DIR` 或 `~/.routa/task-summaries`；文件名 `sanitize(taskId).sanitize(lang).json`（sanitize = 非 `[A-Za-z0-9_-]` 替换为 `_`）；写入用 tmp+rename。
   - `GET`：查任务 → 算 hash → 读缓存 → 返回，不调模型。
   - `POST { language, force }`：命中且 hash 一致直接返回；否则调模型、保存、返回。
2. 提示词与 lint 移植
   - 把 `buildTaskHumanSummaryPrompt` 的 zh/en 文本原样搬到 Rust 常量（两端提示词必须同源；后续改动需同时改两处，在两个文件顶部互相注明）。
   - `TASK_HUMAN_SUMMARY_BANNED_PATTERNS` 用 `regex` crate 复刻；`evidence[].where` 同样豁免。
   - 事实解析：Rust 侧已有 canonical YAML 解析器则复用，否则用 `serde_yaml` 只取 `title / problem_statement / acceptance_criteria / dependencies_and_sequencing / invest.independent.reason` 五段，够拼提示词即可（浏览器端事实层不依赖这个端点）。
3. 模型调用
   - 复用 `AcpAgentCaller` + `AgentCallConfig`，配置读取参照 `review.rs:build_agent_call_config`；model 优先级 `WORKSPACE_AGENT_MODEL` → `ANTHROPIC_MODEL` → 默认。
   - 命中 lint 重试一次（把命中词写进提示词），第二稿命中数不多于第一稿则采纳。
4. 注册路由：`handlers.rs` 路由表加 `.route("/{id}/human-summary", get(...).post(...))`。
5. 契约：`api-contract.yaml` 增加 `/api/tasks/{id}/human-summary` 的 GET 与 POST。
6. 测试
   - Rust 单测：hash 与 TS 对拍（把 `src/core/kanban/__tests__/task-human-summary.test.ts` 里 `HEAVY_DESCRIPTION` 的 hash 值固化为常量对比）；store 读写；lint 命中/豁免。
   - `cargo test -p routa-server`；`npm run api:check` 从「Extra in Next.js」列表中消失并计入 `Both backends implement`。

## 验收标准

- AC1：`npm run -s api:check` 输出里不再出现 `human-summary`，且 `Both backends implement` 计数 +2。
- AC2：对同一张卡，Next.js 与 Rust 端 GET 返回的 `descriptionHash` 相同（用 `c5320340-b1dd-4193-be45-0d4b096cde11` 对拍）。
- AC3：Rust 端 POST 生成后，Next.js 端 GET 立即 `cached:true, stale:false`（共享缓存文件）。
- AC4：`cargo test -p routa-server` 通过，新增 hash/store/lint 单测。
- AC5：桌面 `npm run tauri dev` 打开任一卡的人话版 Tab，下半部分能显示摘要而非 404。

## 不做

- 不改客户端组件；不改 Next.js 端点行为。
- 不把摘要写进 tasks 表（两端都维持文件缓存）。
- 不做 lane 流转时自动刷新（生成时机仍为选项 A）。

## 风险

- 提示词双份维护：Rust 与 TS 各一份，漂移风险由「文件头互相注明 + 同一 PR 内同步改」约束；若后续第三处需要，再抽成共享资源文件（如 `resources/prompts/human-summary.{zh,en}.md`）由两端读取。
- hash 不一致会让两端互相判 stale：AC2 对拍是硬要求。

## 实现记录（2026-09-22）

| 步骤 | 落点 |
|---|---|
| Rust 端点 | `crates/routa-server/src/api/tasks/human_summary.rs`（954 行）：hash / FileSummaryStore / 宽松 YAML 事实解析 / 提示词（与 TS 逐字一致）/ lint（`evidence.where` 同样豁免）/ 一次重试 / GET+POST handler |
| 路由注册 | `crates/routa-server/src/api/tasks/handlers.rs` 路由表 `.route("/{id}/human-summary", get(...).post(...))` |
| 契约 | `api-contract.yaml` 新增 2 条 path + 4 个 schema（`TaskHumanSummary{Evidence,Content,Record,Response}`） |
| 同源标注 | TS 侧 `src/core/kanban/task-human-summary.ts` 文件头注明 Rust twin；Rust 文件头注明 TS 来源 |
| 模型调用 | `AcpAgentCaller` adapter=`anthropic`，model 优先级 `WORKSPACE_AGENT_MODEL` → `ANTHROPIC_MODEL` → `claude-sonnet-4-20250514`，max_tokens 2048，timeout 180s |

hash 对拍向量由 TS 生成（`node --input-type=module -e 'import {createHash} from "node:crypto"; ...'`），固化进 Rust 单测 `hash_matches_typescript_vectors`：三组输入（含 CRLF / 前后空白 / 空串）全部一致。

### 验收结果

| AC | 结果 |
|---|---|
| AC1 parity 计数 | `npm run -s api:check` → `Both backends implement: 238/238`，`human-summary` 不再出现在 Extra 列表 |
| AC2 hash 对拍 | 两端 GET 卡 `c5320340` 均返回 `89374d87ff06…7818ef` |
| AC3 共享缓存 | Rust POST 生成（41.5s，`lintHits: []`）→ Next.js GET 30ms `cached:true stale:false`；反向 Next.js POST / Rust POST 无 force 均 ~25ms 命中缓存 |
| AC4 Rust 测试 | `cargo test -p routa-server` 218 通过（含新增 6 条：hash 对拍、lint 命中与豁免、JSON 三种形态解析、文件 store 读写/损坏容错/文件名 sanitize、事实解析（YAML + 纯文本退化）、提示词拼装）；`cargo clippy -p routa-server -- -D warnings` 零告警 |
| AC5 桌面走查 | **未做**：本轮以两端 HTTP 探针替代 `npm run tauri dev` 手工走查；端点行为已由 AC2/AC3 覆盖，UI 侧组件未改 |

额外探针：Rust 端篡改缓存 hash 后 GET 返回 `stale:true`；不存在的 taskId 返回 404；`language=en` 无缓存时 `record:null`。

### 踩坑

- `api-contract.yaml` 里 `record` 可空写成 `nullable: true + allOf` 会被 `npm run api:schema:validate` 判为 AJV 编译错误（`"nullable" cannot be used without "type"`），改为 `oneOf: [$ref, {type: "null"}]` 通过。
- `rustfmt` 对整个 crate 跑会顺带改到 `list_projection.rs` 的无关测试断言；只对自己新增/修改的三个文件跑 `rustfmt --edition 2021 <files>`，未改的文件用 `git checkout` 还原。
- Rust 侧现有 `parse_canonical_story`（`routa-core/src/models/task.rs:652`）是私有函数且只解析 invest/dependencies，本端点自带一份宽松版 `LooseStory`（全 `Option` 字段），YAML 缺字段不报错、只影响提示词里的事实行。
