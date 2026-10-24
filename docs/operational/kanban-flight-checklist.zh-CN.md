# 起飞检查单岗位与挂岗位脚本（configure-flight-checklist）说明

起飞检查单要解决一个问题：AI 只测常见情况就说做完了。它在看板上加了四道关：

1. 出题人：不看代码，按需求和情况表写验收契约。
2. 开发执行员：按契约施工，并留下证据。
3. 评审守卫：自己重跑全部测试，撤掉实现看测试是否变红，再跑回归题和抽查。
4. 高风险复核员：遇到高风险改动时独立再审一遍。

本文说明这四个岗位的信息，以及怎样用脚本把它们安全地挂到指定看板上。

## 岗位信息

| ID | 中文名 | 英文名 | Role | Model Tier | 挂在哪 |
|---|---|---|---|---|---|
| `kanban-contract-setter` | 出题人 | Contract Setter | `CRAFTER` | `smart` | Todo 列第 2 步（最后一步） |
| `kanban-flight-dev-executor` | 开发执行员（起飞检查单） | Flight Dev Crafter | `CRAFTER` | `smart` | Dev 列，替换 `kanban-dev-executor` |
| `kanban-flight-review-guard` | 评审守卫（起飞检查单） | Flight Review Guard | `GATE` | `smart` | Review 列第 2 步，替换 `kanban-review-guard` |
| `kanban-high-risk-reviewer` | 高风险复核员 | High-Risk Reviewer | `GATE` | `smart` | Review 列第 3 步（最后一步） |
| `kanban-topbi-porter` | TopBI 移植员 | TopBI Porter | `DEVELOPER` | `smart` | Done 列第 1 步（只限 TopBI Board `312b1f5a`） |

每个岗位有三份文件，分别放在三个目录里：

- 默认：`resources/specialists/workflows/kanban/`
- 英文：`resources/specialists/locales/en/workflows/kanban/`
- 中文：`resources/specialists/locales/zh-CN/workflows/kanban/`

文件名依次为 `contract-setter.yaml`、`flight-dev-executor.yaml`、`flight-review-guard.yaml`、`high-risk-reviewer.yaml`。

旧岗位文件（`dev-executor.yaml`、`review-guard.yaml` 等）没有改动。没挂检查单的看板继续用旧岗位。

开发执行员和评审守卫的新文件，是把旧文件的提示词原样复制过来，再在末尾追加「起飞检查单附加规则」一节。只有评审守卫的出口动作被替换了，原因见下文。

### 岗位之间靠固定标题传话

| 固定标题或固定行 | 谁写 | 写在哪 | 谁读 |
|---|---|---|---|
| `## 验收契约（出题人）` | 出题人 | 卡片描述末尾（Todo 阶段描述还能改） | 开发执行员、评审守卫 |
| `回归题已出 N 道（只给评审守卫）` | 出题人 | 契约最后一行 | 评审守卫 |
| `~/.routa/flight-checklist/<完整卡号>/regression.md` | 出题人 | 本机文件，不进卡片 | 评审守卫（文件不存在就写「无回归题」） |
| `## 证据表` | 开发执行员 | 卡片评论（从 Dev 起描述冻结） | 评审守卫 |
| `高风险：是/否（理由）` | 评审守卫 | 评审评论 | 高风险复核员 |
| `【评审打回 第 N 次】` | 评审守卫、高风险复核员 | 打回评论的首行 | 两者共用计数：满 2 次后，第 3 次不通过就判 blocked |
| `## 移植与 alpha 验收` | TopBI 移植员 | 卡片小节（移植成功时） | 完成汇报员 |
| `## 移植失败` | TopBI 移植员 | 失败报告评论的首行 | 完成汇报员 |
| `可合 master：是/否` | TopBI 移植员 | 上面两种评论的最后一行（失败时固定为 `可合 master：否（<原因>）`） | 完成汇报员（原样抄进 `## 完成汇报`） |

开发执行员的证据输出文件放在 `/tmp/routa-evidence/<卡号前 8 位>/`，不进仓库。

### Review 列的出口动作

Review 列有三步：QA、评审守卫、高风险复核员。后面还有步骤没跑时，Routa 会拒绝把卡移出本列。只有一个例外：结论为 NOT_APPROVED 时可以退回 dev。所以三条出口这样分工：

- 评审守卫判通过：只写 `verificationVerdict: "APPROVED"`，不移卡，交给高风险复核员。
- 评审守卫打回：先写 NOT_APPROVED，再 `move_card` 退回 dev。
- 评审守卫第 3 次仍不通过：写 BLOCKED，不移卡，由高风险复核员移到 blocked。
- 高风险复核员：负责把卡移出 Review，去向是 done、dev 或 blocked。

### Done 列的出口动作

TopBI Board 的 Done 列有两步：TopBI 移植员、完成汇报员。同一条闸门（`src/core/kanban/lane-automation-state.ts` 的 `resolveRemainingLaneStepsMoveBlock`，在 `move_card` 时由 `src/core/tools/kanban-tools.ts` 调用）也管这一列：完成汇报员没跑完，移植员就移不出卡。2026-10-22 冒烟卡 2ec8b0b2 的移植员想把失败卡移到 blocked，被 Routa 拒绝，卡留在 Done，看起来像完成了。2026-10-24 起（卡 60f276e0），目标列是 blocked（列 id 为 `blocked`，或该列 stage 为 `blocked`）时，不再受「后续步骤未跑完」闸门限制；PATCH `/api/tasks/<id>` 和 `move_card` 用同一个判断函数 `isExemptFromRemainingLaneStepsGuard`（同一文件）。移到其他列仍会被拦。卡离开某列时，编排器丢掉该列的自动化（`workflow-orchestrator.ts` 的 `handleColumnTransitionData`），所以推送员在跑时卡被移进 Blocked，推送员结束后不会在 Blocked 卡上接着起完成汇报员，也不会给它记失败。丢掉自动化时，编排器记下该列正在跑的会话；这个会话结束时，仍把它的车道记录标为 completed，并结束它的进程（工具调用合成的完成事件要等回合结束才结束进程），只是不起下一步、不恢复、不重跑。Review Guard 用 `update_task` 判 APPROVED 后卡自动收敛进 Done，也走这条路。岗位提示词要不要改回「失败移 blocked」另议，下面的规则暂时不变。现在的出口是：

- 推送：移植 worktree 基于 `origin/dev`，执行 `git push origin HEAD:dev`，只做快进推送到 GitLab dev。alpha 从 GitLab dev 拉代码。被拒（非快进）就 fetch，在新的 `origin/dev` 上重建 worktree，重新 cherry-pick 一次再推；第二次被拒判失败。推完用 `git ls-remote origin refs/heads/dev` 确认远端 dev 等于 `git rev-parse HEAD`。自动回滚的 revert 也这样推。不推 master，不强推，不推 gerrit 远端（Gerrit dev 停在 ce5b3abfa，只查历史）。
- 成功：追加 `## 移植与 alpha 验收`（写 dev 提交号），不移卡。
- 失败：写一条评论，首行 `## 移植失败`，正文写失败步骤、证据路径、回滚提交号和 alpha 构建号（如有），末行 `可合 master：否（<原因>）`。不调用 `move_card`，正常结束，交给完成汇报员。不要把「失败移到 blocked」加回去，原因见上。
- 完成汇报员：卡上有 `## 移植失败` 评论时，`## 完成汇报` 里写明移植失败和失败步骤，原样抄写 `可合 master：否（<原因>）`，不写成交付成功。没有这条评论时行为不变。

还剩一个缺口：「需要你看」面板的「Done 岗位失败 / 跑完没汇报」只看卡上有没有 `## 完成汇报`（`src/app/workspace/[workspaceId]/kanban/kanban-attention-rules.ts` 第 43–51 行）。完成汇报员写完汇报后，移植失败的卡不会亮红标，只能读汇报里的 `可合 master：否` 看出来。要亮红标，需要另开卡改这段代码，例如识别 `## 移植失败` 评论或汇报里的 `可合 master：否`。

Todo 列的情况类似。挂上出题人以后，Todo 编排员按原提示词调用 `move_card` 时会被拒绝，这是预期行为。出题人是 Todo 列最后一步，由它把卡移到 dev。

## 挂岗位脚本

脚本：`scripts/kanban/configure-flight-checklist.ts`。它的写法照 `configure-done-main-pusher.ts`：用 better-sqlite3 直接改 `kanban_boards.columns`。

### 用法

```bash
# 只读检查：打印改前/改后步骤和探针结果，不写库
node --import tsx scripts/kanban/configure-flight-checklist.ts --db <routa.db> --check --boards f635c1de,2c17ef3e,d13eba6a,312b1f5a

# 挂岗位：先探针，全部 200 才备份并写库
node --import tsx scripts/kanban/configure-flight-checklist.ts --db <routa.db> --apply --boards f635c1de,312b1f5a [--backup-dir <目录>] [--base-url http://127.0.0.1:3000]

# 回滚：按备份文件还原
node --import tsx scripts/kanban/configure-flight-checklist.ts --db <routa.db> --rollback <备份文件> --boards f635c1de,312b1f5a [--force]
```

| 参数 | 说明 |
|---|---|
| `--db` | 必填，routa.db 路径 |
| `--check` / `--apply` / `--rollback <备份文件>` | 三选一 |
| `--boards` | 必填，逗号分隔；可写完整 id 或前 8 位。不给就报错退出。前缀匹配不到或匹配到多块，都会报错，不写库 |
| `--allow-routa-board` | Routa Board（`361d06fd-6478-4995-9b6e-ab0b0b271471`）默认拒绝，加这个参数才放行 |
| `--base-url` | 探针地址，默认 `http://127.0.0.1:3000` |
| `--backup-dir` | 备份目录，默认与 db 同目录 |
| `--force` | 只对 `--rollback` 生效：当前配置和备份对不上时也强写 |

### 改成什么样

| 列 | 改前 | 改后 |
|---|---|---|
| todo | `[kanban-todo-orchestrator]` | `[kanban-todo-orchestrator, kanban-contract-setter]` |
| dev | `[kanban-dev-executor]` | `[kanban-flight-dev-executor]` |
| review | `[kanban-qa-frontend, kanban-review-guard]` | `[kanban-qa-frontend, kanban-flight-review-guard, kanban-high-risk-reviewer]` |
| done（只限 TopBI Board `312b1f5a`） | `[kanban-done-reporter]` | `[kanban-topbi-porter, kanban-done-reporter]` |

其他看板的 done 列不改。脚本按列的 `stage` 找列，规则如下：

- 原有步骤（todo-orchestrator、qa-frontend、done-reporter）原样保留。
- 新步骤从被替换的步骤带过来这几个字段：`providerId`、`model`、`reasoningEffort`、`specialistLocale`、`transport`。新增的步骤（出题人、复核员、移植员）从同列相邻的原步骤带。脚本不会另选模型。
- `specialistLocale` 为 zh-CN 时，新步骤用中文名，否则用英文名。
- 列上其他字段原样不动，包括 `requiredArtifacts`、`deliveryRules`、`contractRules`、`requiredTaskFields`。
- automation 顶层的 `role`、`specialistId`、`specialistName` 跟着第一步同步。
- 要替换的原步骤找不到时，脚本报错退出（退出码 1），不会硬塞新步骤。

### 退出码

| 退出码 | 含义 |
|---|---|
| 0 | `--check` 只读检查完成（探针 404 也是 0）；或 `--apply` / `--rollback` 成功；或已是目标状态，什么都没写 |
| 1（非 0 报错） | 参数错误（缺 `--boards`、缺 `--db`、模式不是三选一、未知参数），或数据错误（看板匹配不到或有歧义、Routa Board 未放行、原步骤缺失、备份文件同名已存在、回滚时对不上） |
| 3 | `--apply` 的探针没通过：有岗位返回 404，或连不上 Routa。打印「Routa 进程还没加载新岗位文件（岗位文件按进程缓存，要重启 Routa 才读到）」，不写库，也不建备份 |

### 新岗位文件要重启 Routa 才生效

Routa 进程会缓存岗位文件，按 locale 各缓存一份（`src/core/orchestration/specialist-prompts.ts` 的 `loadSpecialistsSync`），之后不再重读磁盘。所以光把 yaml 合进主干还不够，要重启 Routa，它才认识新岗位。

如果看板引用了没加载的岗位 id，`src/app/api/acp/acp-session-create.ts` 会拿到 null。这时施工者照样启动，但没有系统提示词，而且不报错。脚本在 `--apply` 前先探针，就是为了拦住这种情况。

### 用探针验证

```bash
for id in kanban-contract-setter kanban-flight-dev-executor kanban-flight-review-guard kanban-high-risk-reviewer kanban-topbi-porter; do
  printf '%s ' "$id"; curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:3000/api/specialists?id=$id"
done
```

- 全部 200：可以 `--apply`。
- 有 404：先重启 Routa，再探一次。

`GET /api/specialists` 在生产模式下只读缓存，不写库。不带 `locale` 参数时查的是 en 缓存。重启会让 en 和 zh-CN 两份缓存都重读文件，所以用 en 探测就够了。脚本只在 `--boards` 含 TopBI Board 时，才探测 `kanban-topbi-porter`。

### 备份与回滚

`--apply` 真要写库时，先在 `--backup-dir` 生成备份文件，再写库：

- 备份文件名为 `kanban-flight-checklist-backup-<ISO 时间>.json`。
- 写备份用 `flag: "wx"`。同名文件已存在时报错退出，不覆盖、不写库。
- 内容为 `{ createdAt, boards: [{ id, name, columns, updated_at, newColumns }] }`。其中 `columns` 和 `updated_at` 是原值，`newColumns` 是将写入的新配置。
- 全部看板在一个事务里更新。
- 所有目标看板都已是目标状态时，什么都不写，也不建备份。比较方式是把 JSON 解析后做深比较，所以 Routa 调整了 JSON 键顺序，也算已是目标状态。

`--rollback <备份文件>` 的规则：

- 只有当前 columns 与备份里的 `newColumns` 深比较相等时，才写回原 `columns` 和原 `updated_at`。
- 任一块看板对不上，就整体拒绝，一块都不写，并列出对不上的看板和列（stage）。这样能防止覆盖别人在 `--apply` 之后做的改动。
- 确认要覆盖时加 `--force`。
- 回滚同样在一个事务里完成。

## 真实库只读检查结果（2026-10-22）

对 `/Users/ouweibing/Desktop/topgames_work/routa/routa.db` 跑了 `--check --boards f635c1de,2c17ef3e,d13eba6a,312b1f5a`，结果如下：

- 退出码 0。
- 4 块看板（local-tools、deepseek-harness、turnilo、TopBI）的 todo、dev、review 三列都按上表给出改后步骤；只有 TopBI 的 done 列多出 `kanban-topbi-porter`。
- 5 个岗位的探针都是 404，因为 Routa 还没重启。
- 运行前后，这 4 块看板的 `id, updated_at, columns` 哈希一致。

真实挂岗位不在本次范围。要等以下几件事都完成：本卡与 `kanban-topbi-porter` 卡都进主干，Routa 重启，探针全部 200。之后再执行 `--apply`。

## 变更记录

| 日期 | 改了什么 | 效果 | 提交号 |
|---|---|---|---|
| 2026-10-22 | 新增出题人、开发执行员（起飞检查单）、评审守卫（起飞检查单）、高风险复核员四个岗位（每个三份 yaml），加载测试补四个岗位的加载、角色和提示词断言；新增挂岗位脚本 `configure-flight-checklist.ts`（探针、wx 备份、事务写库、深比较回滚）和 16 条脚本测试 | 真实库只读检查：4 块看板改前/改后步骤正确，探针 5 个都是 404（未重启） | `181673bb`、`40a34ce1`、`dd30db93`（推送前变基可能改变提交号，按改动内容对应） |
| 2026-10-22 | TopBI 移植员改推 GitLab dev（`git push origin HEAD:dev` 只快进，被拒重建 worktree 重试一次，`git ls-remote` 确认；回滚同样推）；去掉 Gerrit 推送、review、query 和 Change-Id；所有失败改为写 `## 移植失败` 评论、不调用 `move_card`；完成汇报员（三份）加一条规则：遇到 `## 移植失败` 时照抄 `可合 master：否`；`topbi-porter-prompt.test.ts` 的危险词加 `gerrit`（不区分大小写）、`move_card` | 相关测试 5 个文件 75 条全过（改前 69 条）；撤掉 6 份 yaml 后 15 条变红 | 本行所在提交（卡 c9686253） |
| 2026-10-24 | 移列闸门放行 blocked：`lane-automation-state.ts` 新增 `isExemptFromRemainingLaneStepsGuard`（review→dev 且 NOT_APPROVED，或目标列 id/stage 为 blocked），`route.ts` 与 `kanban-tools.ts` 两处内联 `allowReviewFallbackToDev` 改为调用它；新增两个测试文件覆盖三种来源列 × 两种 blocked 列 × 两个入口 | 6 个测试文件 111 条：改前 79 过 32 败，改后 111 全过；只撤三个实现文件后 32 条变红（route.test.ts、kanban-tools.test.ts 的 blocked 用例都是断言失败）；豁免函数对拍 11,024 组不一致 0 | 本行所在提交（卡 60f276e0） |
| 2026-10-24 | 评审打回 R2 修复：卡离开某列（列转移事件的来源列不等于目标列）时，编排器在 `handleColumnTransitionData` 开头（第一个 await 之前）丢掉该列的自动化；修复前 `move_card` 把推送员在跑的 Done 卡移进 Blocked 后，推送员结束会在 Blocked 卡上起完成汇报员，失败时记 failed + agent_failed。新增 `workflow-orchestrator-blocked-exit.test.ts`（真实编排器 + EventBus，另放一张留在 Done 的对照卡） | kanban/tools/tasks/kanban 路由 81 个测试文件：撤掉修复 738 过 3 败（`expected 2 to be 1`、`expected 'boom' to be undefined`），修复后 741 全过 | 本行所在提交（卡 60f276e0） |
| 2026-10-24 | 评审打回 R1 修复（第 3 轮）：R2 修复丢旧列自动化时连带丢了该列在跑会话的收尾，导致 `update_task` 收敛后 Review Guard 车道记录停在 running、进程不再结束，`move_card` 进 Blocked 后推送员进程无人结束。编排器改为离列时把在跑会话记进 `departedLaneSessions`，该会话结束时只标 completed 并结束进程（合成完成事件等回合结束），不起下一步、不恢复、不重跑；`workflow-orchestrator-blocked-exit.test.ts` 加 3 条（推送员完成/失败各 1 条、Review Guard 收敛 1 条） | 同一组 81 个测试文件 744 条：撤掉本次修复 3 败 741 过（`expected +0 to be 1`、`expected 'running' to be 'completed'`），修复后 744 全过；Review Guard 用例在 46e6bad9（本卡之前）的编排器上也通过 | 本行所在提交（卡 60f276e0） |
