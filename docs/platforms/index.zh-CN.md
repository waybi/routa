---
title: 平台概览
hide_table_of_contents: true
---

# 平台

Routa 在多个运行时载体上暴露相同的产品模型，因此你可以选择最契合自己工作流的开发者体验。

## 载体对比

| 载体 | 适用场景 | 第一步操作 | 推荐度 |
| --- | --- | --- | --- |
| [桌面端](/platforms/desktop) | 大多数用户、可视化工作流、完整的产品界面 | 从 GitHub Releases 下载 | 推荐 |
| [CLI](/platforms/cli) | 终端优先的使用方式、一次性提示、自动化 | 通过 npm 或 Cargo 安装 `routa-cli` | 推荐 |
| [Web 端](/platforms/web) | 基于浏览器的访问、内部部署、自托管 | 从源码运行应用 | 可选 |

## 如何选择

- 如果你想以最少的搭建成本获得最完整的 Routa 体验，请选择 `Desktop`。
- 如果你已经在终端中工作，并希望直接在代码仓库里进行提示或运行时控制，请选择 `CLI`。
- 如果你想在自己的环境中将 Routa 作为浏览器载体运行，请选择 `Web`。

## 共享的产品语义

在这三种载体上，重要的产品理念保持一致：

- 工作以工作区为范围
- 由 Provider 执行会话
- 代码仓库被关联到工作区
- 会话、看板和团队仍然是核心工作模式

## 继续阅读

- [桌面端](/platforms/desktop)
- [CLI](/platforms/cli)
- [Web 端](/platforms/web)
- [配置](/configuration)：了解 Provider 与环境设置
