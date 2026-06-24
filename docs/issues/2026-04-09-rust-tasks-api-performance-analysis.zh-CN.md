---
title: "Rust 任务 API 性能分析确认了相似的热点路径问题"
date: "2026-04-09"
kind: analysis
status: resolved
severity: medium
area: "backend"
tags: ["rust", "tasks-api", "performance", "analysis"]
reported_by: "agent"
related_issues:
  - "https://github.com/phodal/routa/issues/406"
  - "2026-04-09-next-task-api-head-of-line-blocking.md"
github_issue: 406
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/406"
resolved_at: "2026-04-11"
resolution: "已并入更广义的任务 API 性能追踪项，使 Next.js 与 Rust 的证据归于同一个活跃 issue 家族之下。"
---

# Rust 任务 API 性能分析

**日期：** 2026-04-09  
**关联 Issue：** #406（Next.js 性能问题）  
**状态：** 分析完成 —— 问题已确认

## 摘要

Rust 后端存在与 #406 中识别出的 Next.js 版本**相似的性能问题**。尽管 Rust 的异步运行时提供了更好的基线性能，但其 API 设计模式引入了同样的 N+1 查询和同步 Git 执行问题。

## 去重说明

本文件作为支撑证据保留，但不再被视为一个独立的活跃 issue。活跃追踪项是
`docs/issues/2026-04-09-next-task-api-head-of-line-blocking.md`，它现在同时
涵盖 Next.js 瓶颈以及与 GitHub issue `#406` 关联的 Rust 一致性发现。

## 已识别的问题

### ❌ 问题 1：任务列表序列化过重（N+1 查询）

**位置：** `crates/routa-server/src/api/tasks/handlers.rs:191-217`

**问题：**
```rust
async fn list_tasks(/*...*/) -> Result</*...*/, ServerError> {
    let tasks = state.task_store.list_by_workspace(workspace_id).await?;
    let mut serialized_tasks = Vec::with_capacity(tasks.len());
    for task in &tasks {
        serialized_tasks.push(serialize_task_with_evidence(&state, task).await?); // ❌ N+1
    }
    Ok(Json(serde_json::json!({ "tasks": serialized_tasks })))
}
```

**影响：**
- 对列表中的每个任务，都会调用 `serialize_task_with_evidence`
- 这会触发 `build_task_evidence_summary`，而后者会执行：
  - `state.artifact_store.list_by_task(&task.id)` —— **N 次制品（artifact）查询**
  - `state.kanban_store.get(board_id)` —— **N 次看板（board）查询**

**示例：** 50 个任务 = 1 次任务列表查询 + 50 次制品查询 + 50 次看板查询 = **101 次查询**

### ❌ 问题 2：重复的看板查询

**位置：** `crates/routa-server/src/api/tasks/evidence.rs:18-68`

**问题：**
```rust
async fn serialize_task_with_evidence(state: &AppState, task: &Task) -> Result</*...*/, ServerError> {
    let evidence_summary = build_task_evidence_summary(state, task).await?; // Query 1
    let board = match task.board_id.as_deref() {
        Some(board_id) => state.kanban_store.get(board_id).await?,  // Query 2 (duplicate!)
        None => None,
    };
    // ...
}
```

每个任务的同一个看板被查询了**两次**：
1. 在 `build_task_evidence_summary` 内部（evidence.rs 第 147 行）
2. 又在 `serialize_task_with_evidence` 中（第 24 行）

### ❌ 问题 3：同步 Git 执行

**位置：** `crates/routa-core/src/git.rs`（贯穿整个文件）

**问题：**
所有 Git 操作都使用同步的 `Command::new("git")...output()`：

```rust
pub fn get_repo_changes(repo_path: &str) -> RepoChanges {
    let branch = get_current_branch(repo_path).unwrap_or_else(|| "unknown".into());
    let status = get_repo_status(repo_path);  // Synchronous git status
    let files = Command::new("git")
        .args(["status", "--porcelain", "-uall"])
        .current_dir(repo_path)
        .output()  // ❌ Blocks the async executor thread!
        .ok()
        // ...
}
```

**影响：**
- 在 Git 操作期间阻塞 Tokio 工作线程
- 可能导致其他并发请求出现队头阻塞（head-of-line blocking）
- 对以下操作尤其有问题：
  - `get_repo_changes`（git status）
  - `get_repo_file_diff`（git diff）
  - `get_repo_commit_diff`（git show）

### ❌ 问题 4：缺少缓存层

**缺失：** 没有对以下内容进行缓存：
- 看板配置（对同一 board_id 反复查询）
- 每个任务的制品数量
- Git 仓库状态
- 代码库 / 工作树（worktree）元数据

## 与 Next.js 的性能对比

| 问题 | Next.js (#406) | Rust 后端 | 严重程度 |
|-------|---------------|--------------|----------|
| N+1 制品查询 | ✅ 是 | ✅ 是 | 高 |
| N+1 看板查询 | ✅ 是 | ✅ 是 | 高 |
| 重复看板查询 | ❌ 否 | ✅ 是 | 中 |
| 同步 Git 执行 | ✅ 是（execSync） | ✅ 是（Command::output） | 高 |
| 缺少缓存 | ✅ 是 | ✅ 是 | 中 |
| 队列阻塞 | ✅ 是（事件循环） | ✅ 是（线程池） | 高 |

## 推荐解决方案

### 1. 实现批量加载（高优先级）

为各 store 添加批量查询方法：

```rust
// In artifact_store
pub async fn list_by_tasks(&self, task_ids: &[String]) -> Result<HashMap<String, Vec<Artifact>>>;

// In kanban_store  
pub async fn get_many(&self, board_ids: &[String]) -> Result<HashMap<String, KanbanBoard>>;
```

随后修改 `list_tasks`：

```rust
async fn list_tasks(/*...*/) -> Result</*...*/, ServerError> {
    let tasks = state.task_store.list_by_workspace(workspace_id).await?;
    
    // Batch load all artifacts and boards
    let task_ids: Vec<_> = tasks.iter().map(|t| t.id.clone()).collect();
    let board_ids: Vec<_> = tasks.iter().filter_map(|t| t.board_id.clone()).collect();
    
    let artifacts_map = state.artifact_store.list_by_tasks(&task_ids).await?;
    let boards_map = state.kanban_store.get_many(&board_ids).await?;
    
    // Serialize with pre-loaded data
    let serialized_tasks = serialize_tasks_batch(&tasks, &artifacts_map, &boards_map);
    Ok(Json(serde_json::json!({ "tasks": serialized_tasks })))
}
```

**预计改进：** 101 次查询 → 3 次查询（减少 97%）

### 2. 使用异步 Git 执行（高优先级）

将同步的 `Command::output()` 替换为 `tokio::process::Command`：

```rust
// Before (blocking):
pub fn get_repo_status(repo_path: &str) -> RepoStatus {
    let output = Command::new("git")
        .args(["status", "--porcelain", "-uall"])
        .current_dir(repo_path)
        .output()  // ❌ Blocks
        .ok()?;
    // ...
}

// After (async):
pub async fn get_repo_status(repo_path: &str) -> Result<RepoStatus, Error> {
    let output = tokio::process::Command::new("git")
        .args(["status", "--porcelain", "-uall"])
        .current_dir(repo_path)
        .output()  // ✅ Async
        .await?;
    // ...
}
```

**收益：**
- 不再阻塞 Tokio 工作线程
- 更好的并发请求处理能力
- 消除队头阻塞

### 3. 添加缓存层（中优先级）

实现一个带 TTL 的简单内存缓存：

```rust
use moka::future::Cache;
use std::time::Duration;

pub struct CachedKanbanStore {
    inner: Arc<KanbanStore>,
    cache: Cache<String, Arc<KanbanBoard>>,
}

impl CachedKanbanStore {
    pub fn new(inner: Arc<KanbanStore>) -> Self {
        Self {
            inner,
            cache: Cache::builder()
                .max_capacity(100)
                .time_to_live(Duration::from_secs(60))
                .build(),
        }
    }

    pub async fn get(&self, id: &str) -> Result<Option<Arc<KanbanBoard>>> {
        if let Some(cached) = self.cache.get(id).await {
            return Ok(Some(cached));
        }

        if let Some(board) = self.inner.get(id).await? {
            let board = Arc::new(board);
            self.cache.insert(id.to_string(), board.clone()).await;
            Ok(Some(board))
        } else {
            Ok(None)
        }
    }
}
```

**缓存候选项：**
- 看板配置（很少变化）
- 仓库状态（TTL：5-10 秒）
- 制品数量（TTL：30 秒）

### 4. 优化 serialize_task_with_evidence（中优先级）

移除重复的看板查询：

```rust
async fn serialize_task_with_evidence(
    state: &AppState,
    task: &Task,
    board: Option<&KanbanBoard>,  // Pass pre-loaded board
) -> Result<serde_json::Value, ServerError> {
    let evidence_summary = build_task_evidence_summary(state, task, board).await?;
    let story_readiness = build_task_story_readiness(
        task,
        &resolve_next_required_task_fields(board, task.column_id.as_deref()),
    );
    // ... (no second board query needed)
}
```

### 5. 为大列表添加流式响应（低优先级）

对于非常大的任务列表，可考虑流式处理：

```rust
use futures::stream::StreamExt;

async fn list_tasks_stream(/*...*/) -> impl Stream<Item = Result<Task, Error>> {
    let tasks = state.task_store.list_by_workspace(workspace_id).await?;
    futures::stream::iter(tasks)
        .map(|task| serialize_task_with_evidence(&state, &task).await)
}
```

## 优先行动项

1. **立即（本周）**
   - [ ] 为制品和看板实现批量加载
   - [ ] 移除 `serialize_task_with_evidence` 中的重复看板查询

2. **短期（下个 Sprint）**
   - [ ] 将 Git 操作转为异步（`tokio::process::Command`）
   - [ ] 为看板和仓库状态添加缓存层

3. **中期（下个月）**
   - [ ] 为任务详情实现懒加载（仅在展开时加载）
   - [ ] 为任务列表添加分页
   - [ ] 考虑采用配合 DataLoader 模式的 GraphQL

## 测试计划

1. **对当前性能做基准测试**
   ```bash
   ab -n 100 -c 10 http://localhost:3210/api/tasks?workspaceId=default
   ```

2. **监控数据库查询**
   - 启用 SQLite 查询日志
   - 统计每个请求的查询次数

3. **剖析 Git 操作**
   - 测量花费在 Git 命令上的时间
   - 识别最慢的操作

4. **负载测试**
   - 使用 100+ 个任务进行测试
   - 并发请求（10+ 客户端）
   - 测量响应时间和吞吐量

## 相关文件

- `crates/routa-server/src/api/tasks/handlers.rs` —— 任务 API 处理器
- `crates/routa-server/src/api/tasks/evidence.rs` —— 证据聚合
- `crates/routa-server/src/api/tasks/changes.rs` —— Git 变更追踪
- `crates/routa-core/src/git.rs` —— Git 操作
- Next.js issue：#406

## 参考资料

- Issue #406：Next.js 任务 API 性能问题
- [Tokio Best Practices](https://tokio.rs/tokio/topics/bridging)
- [Async Rust Book - Blocking](https://rust-lang.github.io/async-book/08_ecosystem/00_chapter.html)
