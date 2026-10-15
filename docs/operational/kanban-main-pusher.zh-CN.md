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
- `--apply`：先把原列配置备份成 JSON，再在一个事务里只改目标看板 Done 列的步骤；已配置好的看板重复执行不写入、不备份。

`--apply` 只配置 3 块看板：local-tools Board、deepseek-harness Board、Routa Board。TopBI Board 与 Default Workspace Board 不配置。

## 流程（与 main-pusher.yaml 的 Workflow 第 1–8 步一致）

1. **确认 worktree 和分支**：只在卡片的任务 worktree 里操作，先跑 `git status --short` 和 `git rev-parse --abbrev-ref HEAD`。目标分支 `<branch>` 是代码仓登记的分支（如 `main` 或 `master`）；取不到时用 `git symbolic-ref --short refs/remotes/origin/HEAD` 并去掉 `origin/` 前缀。工作区有未提交改动时不替它提交，把卡移到 blocked，评论里列出这些文件。
2. **TopBI 与 Gerrit 跳过**：判定规则见下文「TopBI/Gerrit 跳过规则」。命中时只写一句评论，然后停止，不移卡。
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

## TopBI/Gerrit 跳过规则

满足任一条件就不推送：

- 代码仓路径含 `topbi`（不区分大小写）；
- `git remote get-url origin` 的输出含 `gerrit` 或 `:29418`。

命中时只用 `update_card` 写一句评论（中文卡片为「主干推送已跳过：TopBI/Gerrit 仓库，走 Gerrit / 发版流程交付。」），然后停止，不移卡。这类仓库走 Gerrit / 发版流程交付。

## 安全规则

- 禁止任何强制推送，不得使用任何带强制含义的推送参数。
- 禁止改写远端历史。
- 唯一允许的推送命令是 `git push origin HEAD:<branch>`，只推送到登记分支 `<branch>`，不推其他分支。
- 不自动解决变基冲突；验证失败的代码不推送。
- 不修改卡片标题和原始描述，只追加评论。
