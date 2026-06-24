---
title: "桌面端工作区路由诊断被数据库与端口冲突所掩盖"
date: "2026-04-02"
status: investigating
severity: high
area: desktop
tags: ["desktop", "tauri", "workspace", "database", "routing", "incident"]
reported_by: "codex"
related_issues:
  - "2026-03-19-tauri-kanban-static-routing-regression.md"
---

# 桌面端工作区路由诊断被数据库与端口冲突所掩盖

## 发生了什么

- 用户报告 Rust 桌面端构建在导航到以下路由时失败：
  - `/workspace/default/kanban`
  - `/workspace/default/overview`
  - `/workspace/default/team`
- 同样的路由据报告在浏览器中可正常工作，这一开始让人以为是仅出现在桌面端的路由回归。
- 在排查过程中，先前启动的 `target/debug/examples/standalone_server` 仍在监听 `127.0.0.1:3210`。
- 新启动的 `./target/release/routa-desktop` 在首次运行时并未真正占用该端口，并打印日志：
  - `Failed to start server: Failed to bind to 127.0.0.1:3210: Address already in use (os error 48)`
- 这意味着早先针对 `http://127.0.0.1:3210` 的浏览器检查命中的是那个残留的 standalone Rust 服务器，而非新重新构建的 Tauri 桌面端后端。
- 桌面端数据源也存在歧义：
  - `~/Library/Application Support/com.routa.desktop/routa.db` 包含桌面应用数据。
  - `/Users/phodal/.routa/routa.db` 存在，但是一个 `0` 字节的文件。
  - 桌面端 UI 中可见的仓库路径为 `/Users/phodal/.routa/repos/phodal--routa`。
- 快速的 SQLite 检查显示，桌面应用数据库包含 `default` 以及若干测试工作区，但观察到的 codebase 行挂在 `Desktop Smoke Workspace` 上，而不是 `default`。

## 预期行为

- 桌面应用启动时，应当明确无误地占用 `127.0.0.1:3210`，或者以足够明显的方式失败，使验证过程不会把另一个进程误认为活跃后端。
- 桌面应用应当清楚地表明它正在使用哪个 SQLite 数据库文件。
- UI 中当前显示的工作区应当与 shell 中可见的 codebase 和仓库路径连贯地对应，而无需交叉核对多个数据库文件。

## 复现上下文

- 环境：桌面端
- 触发条件：
  - 在先前的 standalone Rust 服务器已经绑定 `127.0.0.1:3210` 之后启动桌面应用
  - 导航到工作区路由并检查 UI/数据假设
  - 将 Tauri 可见的工作区状态与 `~/Library/Application Support/com.routa.desktop/` 和 `~/.routa/` 下的本地数据库文件进行比较

## 为何可能发生

- 桌面端验证流程可能假设 `127.0.0.1:3210` 始终属于最近启动的 Tauri 进程，但残留的 standalone Rust 服务器可能继续提供更旧的数据库和更旧的静态前端。
- 桌面端运行时状态至少分散在两个概念之间：
  - Tauri 选定的 SQLite 数据库路径
  - `~/.routa/repos/...` 下的仓库目录
  这会使某个仓库路径看起来是“当前的”，即便活跃的数据库并不是排查者所预期的那个。
- UI 可能以某种方式保留或注水（hydrate）工作区/仓库状态，使其看起来有效，即便底层的数据库/codebase 映射与预期的 default 工作区不同。
- 由于即便在全新的数据库上 `default` 工作区自举和默认看板自举也会发生，因此一个路由可能会部分渲染并看起来像是工作区问题，而更深层的问题实际上是缺失 codebase 或运行时状态混杂。

## 相关文件

- `apps/desktop/src-tauri/src/lib.rs`
- `crates/routa-server/src/lib.rs`
- `src/app/workspace/[workspaceId]/workspace-page-client.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx`
- `docs/issues/2026-03-19-tauri-kanban-static-routing-regression.md`

## 观察记录

- 重新构建的桌面端二进制文件的 Tauri 启动日志：
  - `Database path: /Users/phodal/Library/Application Support/com.routa.desktop/routa.db`
  - `Failed to bind to 127.0.0.1:3210: Address already in use`
- 占用该端口的残留进程：
  - `target/debug/examples/standalone_server`
- 在杀掉残留的 standalone 服务器并重新启动重新构建的桌面应用之后，桌面端后端报告：
  - `version: 0.2.11`
- 在指向 `/Users/phodal/.routa/routa.db` 的情况下查询重新构建的应用，结果为：
  - `default` 工作区存在
  - 默认看板存在
  - 没有 codebase
  - 没有会话
- 直接查询 `/Users/phodal/Library/Application Support/com.routa.desktop/routa.db` 显示：
  - `default|Default Workspace`
  - 多个测试工作区
  - 在 `Desktop Smoke Workspace` 下有一个可见的 codebase 行
- 这留下了一个尚未解决的问题：
  - 为什么用户可见的桌面端 UI 在 `Default Workspace` 下显示了仓库上下文，而快速的数据库检查并未在桌面应用数据库中显示属于 `default` 工作区的 codebase 行。

## 参考

- `target/debug/examples/standalone_server`
- `target/release/routa-desktop`
- `/Users/phodal/Library/Application Support/com.routa.desktop/routa.db`
- `/Users/phodal/.routa/routa.db`

## Issue 卫生

- 2026-04-28：复审后仍判定为活跃。该记录是一个对环境敏感的桌面端诊断缺口，且尚无持久的后续跟进证明数据库/端口归属混淆问题已被消除。
