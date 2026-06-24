---
title: 已禁用的 Provider
---

# 禁用 Provider 功能

## 概述

该功能允许用户禁用可能引发错误（例如 403 Forbidden、认证问题）的特定 ACP Provider，从而阻止它们出现在应用各处的 Provider 选择列表中。

## 问题

部分 ACP Provider 可能因以下原因而无法被所有用户访问：
- 认证/权限问题（403 Forbidden）
- 网络限制
- 订阅/许可证限制
- 区域可用性

当尝试使用这些 Provider 时，会产生如下错误：
```
ACP Error [-32603]: Internal error: Permission denied: HTTP error: 403 Forbidden
```

## 解决方案

用户现在可以通过设置面板禁用有问题的 Provider，这将会：
1. 在所有 Provider 选择下拉框中隐藏它们
2. 阻止自动选中已禁用的 Provider
3. 跨会话持久化禁用状态

## 用法

### 禁用某个 Provider

1. 打开设置（齿轮图标）
2. 切换到 "Providers" 标签页
3. 滚动到 "Disabled Providers" 区域
4. 勾选任意你想禁用的 Provider 旁边的复选框
5. 刷新页面以应用更改

### 重新启用某个 Provider

1. 打开设置 → Providers 标签页
2. 在 "Disabled Providers" 区域，取消勾选该 Provider
3. 刷新页面以应用更改

## 实现细节

### 存储

已禁用的 Provider ID 存储在 localStorage 中，键为 `routa.disabledProviders`：

```typescript
// Example stored value
["kiro", "qoder", "auggie"]
```

### 过滤

Provider 会在多个位置被过滤：
- `useAcp` hook：从后端加载时过滤 Provider
- Provider 列表：所有 Provider 列表都会遵循禁用状态

### API

`src/client/utils/custom-acp-providers.ts` 中新增的工具函数：

```typescript
// Load disabled provider IDs
loadDisabledProviders(): string[]

// Save disabled provider IDs
saveDisabledProviders(providerIds: string[]): void

// Check if a provider is disabled
isProviderDisabled(providerId: string): boolean

// Disable a provider
disableProvider(providerId: string): void

// Enable a provider
enableProvider(providerId: string): void

// Toggle a provider's disabled state
toggleProviderDisabled(providerId: string): boolean
```

## 修改的文件

1. `src/client/utils/custom-acp-providers.ts` - 新增已禁用 Provider 的管理函数
2. `src/client/hooks/use-acp.ts` - 加载时过滤已禁用的 Provider
3. `src/client/components/settings-panel.tsx` - 新增管理已禁用 Provider 的 UI

## 后续增强

- 自动禁用持续认证失败的 Provider
- 在已禁用 Provider 列表中提供针对各 Provider 的错误信息
- 批量启用/禁用操作
- 导出/导入已禁用 Provider 的配置
