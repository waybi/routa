---
title: Provider 与模型
---

# Provider 与模型

Routa 可以通过本地 ACP 支持的 Provider 以及基于 API 的 Provider 连接来执行工作。

## 内置 Provider 类型

当前常见的内置选项包括：

- `Claude Code`
- `OpenCode`
- `OpenCode SDK`
- `Codex`

## 配置入口

在 UI 中，Provider 的设置分散在以下几处：

- `Providers`：可用运行时、可见性以及 Provider 专属凭据
- `Registry`：可安装的 ACP Agent
- `Role Defaults`：每个角色的默认 Provider/模型选择
- `Models`：保存的模型别名，包含 base URL 和 API key

## 推荐配置顺序

1. 在 `Providers` 中让一个 Provider 可用。
2. 如有需要，在 `Models` 中创建一个模型别名。
3. 在 `Role Defaults` 中将该 Provider/模型绑定到某个角色。
4. 返回工作区并启动一个会话。

## 产品层面的含义

你不需要配置所有 Provider。一个可用的 Provider 就足以开始使用。

## 相关文档

- [快速开始](/quick-start)
- [环境变量](/configuration/environment-variables)
