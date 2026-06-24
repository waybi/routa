---
title: AgentWatch TUI
---

# AgentWatch TUI

AgentWatch 是一个以 TUI 为先的本地运行时，用于在单个仓库内进行多 Agent 编码归属（attribution）追踪。

本文档是 TUI 信息架构与运行时模型的规范设计说明。

## Product Shape

主入口为：

```bash
agentwatch tui
```

该 TUI 实时回答两个问题：

- 谁正在改动哪些文件
- 当前未提交的工作进展到了哪里

该产品以会话为中心，而非以 diff 为中心。

## Runtime Model

AgentWatch 是一个长期运行的本地进程，具有三类输入：

- Codex hooks
- Git hooks
- 来自 `git status --porcelain` 的周期性仓库扫描

该进程将活跃状态保存在内存中。Hook 命令不会直接查询 UI 状态，而是将结构化事件追加写入一个仓库范围的运行时 feed：

- `/tmp/agentwatch/runtime/<repo-hash>.jsonl`

这个 feed 刻意保持简单：

- 仅追加（append-only）
- 仅本地（local-only）
- 每次 hook 调用采用单写入者模式
- 无守护进程联网需求

TUI 通过 tail 该 feed，并将事件折叠进内存中的状态树。
启动时它从 feed 的当前末尾开始，因此默认的实时视图代表「从现在起」，而不是重放陈旧的演示数据。

## Information Architecture

默认屏幕布局使用四个区域：

1. `Sessions`
   - 活跃 / 空闲 / 已停止
   - 模型
   - 触及的文件数量
   - 可用时显示 tmux pane
   - 最近活动时间戳

2. `Files`
   - 选定会话视图或全局视图
   - 脏（dirty）状态
   - 归属置信度
   - 最近归属的会话
   - 当多个会话触及同一文件时显示冲突标记

3. `Detail`
   - 选定文件或会话的详情
   - 近期事件摘要
   - 置信度与冲突状态
   - 当前运行时 feed 路径

4. `Event Log`
   - 按时间倒序的 hook 与 git 事件
   - 旨在作为操作者时间线，而非完整审计日志

## State Model

TUI 将事件折叠进三个状态桶：

### Sessions

- `session_id`
- `cwd`
- `model`
- `client`
- `started_at_ms`
- `last_seen_at_ms`
- `status`
- `tmux_pane`
- `touched_files`
- `last_turn_id`

### Files

- `rel_path`
- `dirty`
- `state_code`
- `last_modified_at_ms`
- `last_session_id`
- `confidence`
- `conflicted`
- `touched_by`
- `recent_events`

### Event Log

- `observed_at_ms`
- `message`

## State Transitions

### Hook Event

- upsert 会话
- 刷新 `last_seen_at_ms`
- 当事件为 stop 生命周期事件时标记为已停止
- 如果事件包含文件路径，则将文件标记为脏，并将其归属到该会话
- 如果此前另一个会话拥有该文件，则将文件标记为冲突
- 推入一行精简的事件日志

### Git Event

- 推入一行事件日志
- 在 `post-commit`、`post-checkout`、`post-merge` 时清除脏标记，直到下一次扫描重新填充它们

### Repo Scan Tick

- 运行 `git status --porcelain --untracked-files=all`
- 刷新脏文件集合
- 在可用时更新每个文件的 mtime
- 在推断窗口过期后，将会话从 `active` 移动到 `idle`

## Keybindings

当前 V0 绑定：

| Key | Action |
|---|---|
| `Tab` | 在 Sessions、Files、Detail 之间循环切换焦点 |
| `j` / `Down` | 选择项下移 |
| `k` / `Up` | 选择项上移 |
| `s` | 在按会话分组视图与全局文件视图之间切换 |
| `d` | 在详情面板的摘要视图与 diff 视图之间切换 |
| `r` | 切换跟随模式 |
| `q` | 退出 |

计划中的后续绑定：

| Key | Planned Action |
|---|---|
| `/` | 搜索会话/文件 |
| `f` | 文件过滤模式 |
| `t` | 按最近修改时间排序 |
| `d` | 显示 diff 摘要 |
| `e` | 在 `$EDITOR` 中打开当前文件 |
| `g` | 跳转到 git diff 视图 |
| `Enter` | 展开详情模式 |

## Design Constraints

- 产品必须显式呈现 `unknown` 与 `conflicted`。
- 实时状态是主要的；SQLite 存储是次要的兼容性/调试基础设施。
- 即使 hook 乱序到达，或实时进程在部分文件已经变脏之后才启动，TUI 也应保持可用。
- 运行时传输必须能在本地 tmux 环境中工作，而无需依赖外部服务。
