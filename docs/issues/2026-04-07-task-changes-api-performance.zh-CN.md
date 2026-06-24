---
date: 2026-04-07
title: 任务变更 API 性能瓶颈
status: resolved
severity: high
area: kanban
affected_component: API - /api/tasks/[taskId]/changes
github_issue: 385
github_state: closed
github_url: https://github.com/phodal/routa/issues/385
---

# 任务变更 API 性能瓶颈

## 问题

当处理包含大量文件变更的任务时，`/api/tasks/[taskId]/changes` API 端点存在严重的性能问题。

**观察到的行为：**
- 对于一个有 2006 个变更文件的任务，响应时间达到 **169 秒（2.8 分钟）**
- 对于具有大型变更集的任务，该 API 完全无法使用
- UI 在等待响应时被阻塞

## 根因

瓶颈位于 `src/core/git/git-utils.ts` 中的 `getRepoChanges()` 函数：

1. **逐文件执行 git**：对于每个变更文件，代码会顺序执行多达 3 条 git diff 命令以获取行级统计（新增/删除）
2. **低效迭代**：在 2006 个文件的情况下，这可能导致超过 6000 次单独的 git 命令执行
3. **缺少全局上限**：常量 `MAX_UNTRACKED_FILES_WITH_SYNTHETIC_STATS` 只限制了未跟踪文件（25 个），而所有已修改/已新增/已删除/已重命名的文件仍会触发昂贵的逐文件 git diff 调用
4. **没有缓存**：每次 API 请求都会从头重新计算所有内容

## 解决方案

实现了 4 项性能优化：

### 1. ✅ 批量获取所有文件的 numstat

**改动**：`src/core/git/git-utils.ts` 中的 `getRepoChanges()`

不再是：
```typescript
// For each file: run git diff --numstat <file>
files.map(file => getRepoFileLineStats(repoPath, file))
```

现在变为：
```typescript
// Once: run git diff --numstat (all files)
const batchStats = batchGetRepoFileStats(repoPath);
files.map(file => batchStats.get(file.path) || fallback(file))
```

**效果**：从每次 API 调用约 6000 条 git 命令 → 3 条 git 命令。

### 2. ✅ 全局文件数量上限

**新增**：`MAX_CHANGED_FILES_WITH_DETAILED_STATS = 500`

无论文件类型如何，将详细统计计算的文件数上限设为 500，防止灾难性的性能下降。

### 3. ✅ LRU 缓存

**新增**：为 `getRepoChanges()` 的结果引入 5 秒 TTL 缓存

```typescript
const repoChangesCache = new LRUCache<string, RepoChanges>({
  max: 100,
  ttl: 5000, // 5 seconds
});
```

在不重新执行 git 命令的情况下，处理 UI 的快速轮询/刷新。

### 4. ✅ 懒加载 API

**新建**：`/api/tasks/[taskId]/changes/stats?paths=file1,file2,...`

用于按需获取文件统计的新端点。它让 UI 能够：
- 即时加载文件列表
- 仅为可见文件请求统计数据
- 随着用户滚动进行渐进式增强

## 性能结果

### 优化前
```
⏱️  TOTAL TIME: 169033ms (169 seconds)
   - getRepoChanges(): 168402ms 🔥 BOTTLENECK
   - Files: 2006
```

### 优化后
```
⏱️  TOTAL TIME: 2200ms (2.2 seconds)
   - getRepoChanges(): ~2000ms ✅ FAST
   - Files: 2006
   
Cache hit (request #3): 420ms ✅ VERY FAST
```

**整体提升**：**快 77 倍**（169 秒 → 2.2 秒）

## 改动的文件

- `src/core/git/git-utils.ts` - 核心优化逻辑
- `src/app/api/tasks/[taskId]/changes/route.ts` - 更新 API 文档
- `src/app/api/tasks/[taskId]/changes/stats/route.ts` - 新增懒加载端点
- `package.json` - 新增 `lru-cache` 依赖

## 测试

使用任务 `03ee3456-9df2-43df-bd28-60df023e99f1` 进行测试：
- 2006 个变更文件
- 响应时间：169 秒 → 2.2 秒
- 缓存生效：第 3 次请求耗时 0.42 秒
- 所有文件统计数据保持准确

## 验收标准

- [x] 对于包含 2000+ 变更文件的仓库，API 响应时间 < 2 秒
- [x] 热路径中不再有逐文件的单独 git 命令执行
- [x] 对于超大型变更集进行优雅降级（500 文件上限）
- [x] 在展示时保持准确的行级统计（新增/删除）
- [x] 缓存对快速请求生效
- [x] 提供懒加载端点以支持渐进式增强

## 后续步骤

- [ ] 更新前端，对大型变更集使用懒加载端点
- [ ] 添加遥测以追踪生产环境中的 API 性能
- [ ] 考虑对其他 git 密集型端点进行类似优化

## 参考

- GitHub Issue：#385
- 性能剖析脚本：`scripts/debug-task-changes-perf.ts`
