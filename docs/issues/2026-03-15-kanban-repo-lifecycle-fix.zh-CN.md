---
date: 2026-03-15
title: 看板仓库生命周期修复
status: resolved
area: kanban
labels: [bug, kanban, ux]
---

# 看板仓库生命周期修复

## 问题

用户在尝试从看板页面添加仓库时，遇到了一个断裂的导航循环：

1. **看板页面**（`/workspace/{id}/kanban`）显示「No repositories linked」（未关联任何仓库）
2. 点击「Add one in Settings →」（在设置中添加 →）后跳转到 `/workspace/{id}?tab=settings`
3. **仪表盘页面**（`/workspace/{id}`）并没有 `settings` 标签页
   - 只有：`kanban`、`notes`、`activity` 标签页
4. 用户被卡住——既无法添加仓库，也无法继续操作

### 根本原因

看板页面链接到了仪表盘页面上一个不存在的标签页。仪表盘已被重新设计为精简的三标签布局（Kanban、Notes、Activity），但看板页面仍然引用旧的 `settings` 标签页。

## 解决方案

用一个**内联的 RepoPicker** 组件替换这个断裂的链接，让用户无需跳转即可直接在看板页面上克隆/选择仓库。

### 实现

**修改前**：
```tsx
{codebases.length === 0 ? (
  <div className="...">
    <span>No repositories linked.</span>
    <a href={`/workspace/${workspaceId}?tab=settings`}>
      Add one in Settings →
    </a>
  </div>
) : (
  // ... existing repos
)}
```

**修改后**：
```tsx
{codebases.length === 0 ? (
  <div className="flex flex-col gap-2 ...">
    <span>No repositories linked.</span>
    <div className="flex items-center gap-2">
      <RepoPicker
        value={null}
        onChange={async (selection) => {
          if (!selection) return;
          try {
            const res = await fetch(`/api/workspaces/${workspaceId}/codebases`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ 
                repoPath: selection.path, 
                branch: selection.branch, 
                label: selection.name 
              }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? "Failed to add repository");
            onRefresh?.(); // Refresh codebases list
          } catch (err) {
            console.error("Failed to add repository:", err);
            alert(err instanceof Error ? err.message : "Failed to add repository");
          }
        }}
        additionalRepos={[]}
      />
    </div>
  </div>
) : (
  // ... existing repos
)}
```

### 关键改动

1. **内联 RepoPicker**：用户可以直接选择/克隆仓库
2. **API 集成**：调用 `/api/workspaces/{id}/codebases` POST 端点
3. **自动刷新**：添加成功后调用 `onRefresh()`
4. **错误处理**：失败时弹出 alert 提示
5. **无需跳转**：用户始终停留在看板页面

## 收益

✅ **更好的用户体验**：无需页面跳转
✅ **一致的模式**：与 HomeInput 组件相似
✅ **修复生命周期问题**：不再有断裂的导航循环
✅ **即时操作**：用户可以立即开始工作
✅ **错误反馈**：失败时给出清晰的错误信息

## 测试

手动测试已确认：
- ✅ 未关联任何仓库时会显示 RepoPicker
- ✅ 可以选择已有的本地仓库
- ✅ 可以克隆 GitHub 仓库
- ✅ 添加后仓库列表会刷新
- ✅ 错误处理正常工作
- ✅ 没有断裂的导航链接

## 相关组件

- `RepoPicker`：用于仓库选择/克隆的可复用组件
- `HomeInput`：首页采用的相似模式
- `WorkspaceSettingsTab`：完整的设置页面（仍可通过 Settings 菜单访问）

## 提交

```
commit 2a1b788
fix(kanban): add inline RepoPicker for empty repository state
```
