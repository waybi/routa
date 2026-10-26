# 主干推送员（kanban-main-pusher）说明

主干推送员是 Kanban 看板 Done 列的第一个岗位。卡片通过 Done 闸门后，它把任务分支变基到远端主干、重跑验证，再用普通推送把提交送进主干，并把主干提交号写进卡片评论。

## 岗位信息

| 项目 | 内容 |
|---|---|
| ID | `kanban-main-pusher` |
| 中文名 | 主干推送员 |
| 英文名 | Main Pusher |
| Role | `DEVELOPER` |
| Model Tier | `smart` |
| 源文件（默认） | `resources/specialists/workflows/kanban/main-pusher.yaml` |
| 源文件（中文） | `resources/specialists/locales/zh-CN/workflows/kanban/main-pusher.yaml` |
| 源文件（英文） | `resources/specialists/locales/en/workflows/kanban/main-pusher.yaml` |

岗位清单登记在 `resources/specialists/workflows/kanban/workflow.yaml`（通用工作流岗位的专用岗位列表含 `kanban-main-pusher`）。

岗位目录页由 `npm run docs:specialists:generate`（脚本 `scripts/docs/generate-specialist-docs.ts`）从 `resources/specialists` 生成到 `docs/specialists/`。该目录被 `.gitignore` 忽略，不入库，需要时在本地重新生成。

## 在 Done 列的位置

Done 列的步骤顺序为：

```text
[kanban-main-pusher, kanban-done-reporter]
```

主干推送员排在完成汇报员前面。推送成功时它不移卡，Done 列下一步交给完成汇报员。

配置由 `scripts/kanban/configure-done-main-pusher.ts` 完成：

- `--check`：只读检查，不写数据库。
- `--apply`：先把原列配置备份成 JSON，再在一个事务里只改判定为「要配」的看板 Done 列的步骤；已配置好的看板重复执行不写入、不备份。

脚本不维护看板名单。它读取 `kanban_boards` 全部看板（按 `created_at`、`id` 排序），按看板所在工作区在 `codebases` 表里绑定的代码仓逐块判定。下面 5 条按顺序检查，命中一条就跳过，并写明原因：

1. 工作区代码仓数量不是 1：0 个时原因为「未绑定代码仓」，2 个及以上时原因为「多代码仓，不自动推送」。
2. 代码仓目录不存在，或 `git -C <repo_path> rev-parse --git-dir` 失败：原因写明路径。
3. `git -C <repo_path> remote get-url origin` 失败：原因为「没有 origin 远端」。
4. `repo_path` 匹配正则 `/topbi/i`，或 origin 含 `gerrit` 或 `:29418`（都不区分大小写）：原因为「Gerrit 走评审，不直推」。
5. Done 列不存在，或 Done 列没有 `kanban-done-reporter` 步骤：原因写明缺什么。

5 条都没命中，判定为「要配」，原因写明代码仓路径。任一看板判定出错只记为跳过，脚本不会因此以非 0 退出。`--check` 每块看板输出一行：看板名、判定、原因、当前 Done 步骤。`--apply` 只改判定为「要配」且 Done 步骤还不是 `[kanban-main-pusher, kanban-done-reporter]` 的看板。

第 4 条只在这个离线配置脚本里生效。推送员运行时（`main-pusher.yaml` Workflow 第 2 步）自 2026-10-26 起改看知识库解析器给出的交付方式，见下文「交付方式跳过规则」。Done 列挂哪些岗位现在由 `scripts/kanban/configure-flight-checklist.ts` 按解析器的 `done_steps` 决定，见 `docs/operational/kanban-flight-checklist.zh-CN.md`。

按 2026-10-22 真实数据只读 `--check` 的结果：local-tools Board、deepseek-harness Board、Routa Board、turnilo Board 判定为要配（Done 列已配好）；TopBI Board 跳过（Gerrit），Default Workspace Board 跳过（多代码仓，绑了 2 个）。

## 流程（与 main-pusher.yaml 的 Workflow 第 1–8 步一致）

1. **确认 worktree 和分支**：只在卡片的任务 worktree 里操作，先跑 `git status --short` 和 `git rev-parse --abbrev-ref HEAD`。目标分支 `<branch>` 是代码仓登记的分支（如 `main` 或 `master`）；取不到时用 `git symbolic-ref --short refs/remotes/origin/HEAD` 并去掉 `origin/` 前缀。工作区有未提交改动时不替它提交，把卡移到 blocked，评论里列出这些文件。
2. **交付方式不是主干推送就跳过**：判定规则见下文「交付方式跳过规则」。命中时只写一句评论，然后停止，不移卡。
3. **拉取**：执行 `git fetch origin`。
4. **变基**：执行 `git rebase origin/<branch>`。出现冲突时不解决冲突：用 `git diff --name-only --diff-filter=U` 列出冲突文件，执行 `git rebase --abort`，在评论里写明全部冲突文件，再把卡移到 blocked，停止。
5. **验证**：在 worktree 里按顺序逐条运行卡片的 `verificationCommands`。任一命令失败，就在评论里写明失败的命令和关键报错，把卡移到 blocked，停止，不推送。卡片没有验证命令时，在最终评论里写明，然后继续。
6. **推送**：只执行 `git push origin HEAD:<branch>`。推送被拒（如主干已前进导致非快进）时，可以把第 3–6 步重做一次；仍被拒就在评论里记下原始报错，把卡移到 blocked，停止。
7. **核实已进主干**：执行 `git fetch origin`，用 `git rev-parse HEAD` 取得 `<commit>`，再执行 `git merge-base --is-ancestor <commit> origin/<branch>`。退出码 0 表示提交已在主干上。
8. **写主干提交号**：用 `update_card` 写一条评论，包含下面的固定行，供完成汇报员引用，同时列出已通过的验证命令。
   - 英文卡片：`Mainline commit: <sha> (origin/<branch>)`
   - 中文卡片：`主干提交号: <sha> (origin/<branch>)`

## 什么时候把卡移到 blocked

以下 4 种情况，主干推送员停止工作，把卡移到 blocked：

| 情况 | 所在步骤 | 评论里写什么 |
|---|---|---|
| 工作区有未提交改动 | 第 1 步 | 未提交的文件清单 |
| 变基冲突 | 第 4 步 | 全部冲突文件 |
| 验证命令失败 | 第 5 步 | 失败的命令和关键报错 |
| 推送重试一次后仍被拒 | 第 6 步 | 推送的原始报错 |

主干推送员不自动解决冲突，不推送验证失败的代码。

## 交付方式跳过规则

推送员先跑知识库里的统一解析器，取这张卡所属项目的交付方式：

```bash
python3 ~/Desktop/my/knowledge-system/tools/flight_resolve.py --card <完整卡号> --format json
```

- 输出的 `delivery` 是 `main-push`：照常推送。
- `delivery` 是别的值（如 TopBI 的 `port-dev-alpha`）：不推送，只用 `update_card` 写一句评论，然后停止，不移卡。中文卡片：「主干推送已跳过：本项目交付方式是 <delivery>，按该方式交付。」；英文卡片：`Mainline push skipped: this project delivers via <delivery>; deliver through that path.`
- 解析器退出码非 0（如卡号匹配到 0 张卡）或输出里没有 `delivery`：退回远程判断，`git remote get-url origin` 含 `gerrit` 或 `:29418` 就跳过（评论「主干推送已跳过：Gerrit 仓库，走 Gerrit / 发版流程交付。」），否则照常推送。

回退判断只防 Gerrit 仓库。TopBI 自 2026-10-22 起 origin 是 GitLab，回退判断对它不生效；TopBI 不被误推，靠的是解析器给它的 `done_steps` 里没有推送员，Done 列根本不挂 `kanban-main-pusher`。

## 安全规则

- 禁止任何强制推送，不得使用任何带强制含义的推送参数。
- 禁止改写远端历史。
- 唯一允许的推送命令是 `git push origin HEAD:<branch>`，只推送到登记分支 `<branch>`，不推其他分支。
- 不自动解决变基冲突；验证失败的代码不推送。
- 不修改卡片标题和原始描述，只追加评论。

## 变更记录

| 日期 | 改了什么 | 效果 | 提交号 |
|---|---|---|---|
| 2026-10-22 | 目标看板加入 turnilo Board（`d13eba6a-42db-43ed-835b-18c544f6c985`，登记分支 master），Done 列配成 `[kanban-main-pusher, kanban-done-reporter]`；加载测试补「推送员提示词不写死 main」断言（不含 `HEAD:main`、`origin/main`） | 目标看板 3→4 | `d1bfa79f`（变基后提交号可能变化，按改动内容对应） |
| 2026-10-22 | 去掉写死的 `TARGET_BOARD_IDS` 看板名单，改为扫描全部看板，按工作区绑定的代码仓（数量、目录与 git、origin、TopBI/Gerrit）和 Done 列结构逐块判定「要配 / 跳过」并写原因；测试补未绑代码仓、目录不存在、无 origin、只命中 `:29418`、Done 列缺完成汇报员 5 个边界看板 | 看板名单→自动判定，新看板免改名单；真实库 4 块要配、2 块跳过 | `d89c5c5f`（变基后提交号可能变化，按改动内容对应） |
| 2026-10-26 | 推送员第 2 步改为跑 `flight_resolve.py --card <完整卡号> --format json` 取 `delivery`，不是 `main-push` 就跳过；解析器失败时退回 origin 含 `gerrit` / `:29418` 判断；删掉按代码仓路径认 TopBI 的运行时判断 | 新增项目只改知识库档案，不改推送员提示词 | 见本卡提交（变基后提交号可能变化） |
