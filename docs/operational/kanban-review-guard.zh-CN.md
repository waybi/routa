# 评审守卫（kanban-review-guard）说明

评审守卫是 Kanban 看板 Review 列的岗位。它不信 Dev 的自报，自己核对验收标准、提交、工作区和测试，并逐条复跑卡上的 `verificationCommands`，再决定退回 Dev、判 BLOCKED，或判 APPROVED 推进到 Done。

## 岗位信息

| 项目 | 内容 |
|---|---|
| ID | `kanban-review-guard` |
| 中文名 | 评审守卫 |
| 英文名 | Review Guard |
| Role | `GATE` |
| Model Tier | `smart` |
| 源文件（默认） | `resources/specialists/workflows/kanban/review-guard.yaml` |
| 源文件（中文） | `resources/specialists/locales/zh-CN/workflows/kanban/review-guard.yaml` |
| 源文件（英文） | `resources/specialists/locales/en/workflows/kanban/review-guard.yaml` |

默认 locale 是 en，加载器给 en 读根目录文件，`locales/en` 只是覆盖候选；看板步骤带 `specialistLocale: zh-CN` 时读 `locales/zh-CN`。三份文件要一起改，关键句由 `src/core/specialists/__tests__/kanban-todo-review-prompts.test.ts` 锁定。

## 新增规则：逐条复跑 verificationCommands

```text
取命令原文 → 在卡的 worktree 根目录逐条原样跑 → 在 Review Findings 逐条记录 → 全部退出码 0 才能判 APPROVED
```

### 命令从哪里取

评审守卫的会话提示词里只有 `verificationCommands=present`，看不到命令原文。MCP 的 `search_cards`、`list_cards_by_column` 返回的卡片也不带这个字段（它们只多了 `verificationVerdict`）。取法按顺序：

1. 调 MCP `get_task`（只读；`taskId` 可省，省略时读当前会话绑定的卡），取返回里的 `verificationCommands`。同一次返回还带评论（按时间升序）、`verificationVerdict`、`verificationReport` 和各步骤摘要；默认回复不超过 32 KB，要更多正文时传 `commentLimit`、`maxCommentChars`。Web（`src/core/mcp/get-task-tool.ts`）和桌面（`crates/routa-server/src/api/mcp_routes/tool_executor/get_task.rs`）两个后端都有，kanban-planning 工具集也包含它。
2. MCP 调不到时兜底：`curl -s http://127.0.0.1:3000/api/tasks/<cardId>`，取 `.task.verificationCommands`。这个 GET 只读（`src/app/api/tasks/[taskId]/route.ts`）。3000 是本机 routa-prod 的端口。
3. 再取不到时：`sqlite3 -readonly <routa 仓库>/routa.db "select verification_commands from tasks where id='<cardId>'"`。
4. 都取不到：判 `BLOCKED`，写明原因，不得判 APPROVED。

### 怎么跑、怎么记

- 在卡的 worktree 根目录按原文逐条跑，不改写成能跑通的形式。命令本身写错（路径、通配符不对）判不通过，并在反馈里给出改好的写法。
- Review Findings 新增一节，每条命令一行：`` `<命令>` → 退出码 <code> → <关键输出一行> ``（英文模板写作 `` `<cmd>` → exit <code> → <one key output line> ``）。
- 卡上没有命令时写「卡上无 verificationCommands」（英文卡写 `No verificationCommands on the card`）。

### 判定

| 情况 | 判定 |
|---|---|
| 全部命令由评审守卫亲自跑过，退出码全为 0 | 可以判 APPROVED（其他检查也要通过） |
| 有命令没跑，或退出码非 0 | 不得判 APPROVED，退回 Dev |
| 某条命令在干净的 origin/main 上也失败（基线失败） | 判 BLOCKED，附两次输出，不退回 Dev |
| 取不到命令原文 | 判 BLOCKED |

这条写进了根文件和英文文件的 Hard Rejection Criteria 第 7 条、Review Findings 模板、Exit Gate 自检表和 Required behavior 第 4.5 步；中文文件写进规则清单第 7 条和「通过」的前提。

### local-tools 卡的补充说明

local-tools 的 pre-push 会跑 `bash scripts/validate-changed.sh --strict --base origin/main` 拦推送。如果主干在本卡之后又有新提交，要在临时 worktree 里 rebase 到 origin/main 后再跑这条才算数。这个细节只写在本文档，提示词只要求按卡上原文、在卡的 worktree 里跑。

## 为什么这样改

| 复盘 | 现象 | 改法 |
|---|---|---|
| L256 | 原提示词没要求评审守卫自己复跑卡上的命令。卡 b2e66591 漏跑 `bash scripts/validate-changed.sh --strict --base origin/main`，这条后来在 pre-push 拦下了推送；卡 1e8cafaa 漏跑 4 条 py_compile 里的 1 条 | 逐条复跑成为硬拒绝条件，并写明命令取法和记录格式 |

## 变更记录

| 日期 | 改了什么 | 对应复盘 | 提交号 |
|---|---|---|---|
| 2026-10-21 | 新增逐条复跑 verificationCommands 规则（硬拒绝第 7 条、Findings 复跑记录、Exit Gate 自检行、命令取法、基线失败判 BLOCKED）；新增三路径提示词单测断言 | L256 | 见本提交 |
| 2026-10-24 | 新增 MCP `get_task` 只读工具（Web 与桌面两个后端，含 kanban-planning 与 team-coordination 工具集），verificationCommands 改为优先用 `get_task` 读取，curl 与 sqlite3 降为兜底；taskToCard（`search_cards`、`list_cards_by_column`）补 `verificationVerdict` | L296 | 见本提交 |
