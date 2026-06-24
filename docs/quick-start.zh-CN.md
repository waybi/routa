---
title: 快速开始
sidebar_position: 2
---

# 快速开始

Routa 目前提供三种方式开始使用产品：

- `Desktop`：适合大多数用户的最佳默认选项
- `CLI`：适合以终端为先的工作流
- `Web`：适合以浏览器为先的访问以及自托管

如果你只想用最短路径让“Routa 跑起来并产生价值”，请从 `Desktop` 或 `CLI` 开始。

## 首次成功清单

最初 5 分钟的正确目标不是“理解 Routa 的全部”，而是：

1. 选择一个使用界面
2. 让一个 Provider 可用
3. 让 Routa 指向一个真实的代码仓库
4. 得到一个有用的回答或计划

## 你应该选择哪条路径？

| 路径 | 适合 | 安装方式 | 推荐度 |
|---|---|---|---|
| Desktop | 大多数用户、可视化工作流、看板/会话/团队 UI | 从 [GitHub Releases](https://github.com/phodal/routa/releases) 下载 | 推荐 |
| CLI | 以终端为先的用户、脚本化、ACP/运行时命令 | `npm install -g routa-cli` 或 `cargo install routa-cli` | 推荐 |
| Web | 自托管、基于浏览器的访问、内部部署 | 从源码运行 Web 端运行时 | 可选 |

## 最快路径

如果你想要最短的“能用就行”路径，请使用以下方式之一：

### Desktop 实践

1. 从 [GitHub Releases](https://github.com/phodal/routa/releases) 下载 Routa Desktop。
2. 创建一个工作区并启用一个 Provider。
3. 关联一个代码仓库。
4. 打开 `Session`，并提问：`Explain the architecture of this repository`。

### CLI 实践

```bash
npm install -g routa-cli
routa -p "Explain the architecture of this repository"
```

如果针对一个真实仓库它返回了有用的回答，那么你的 CLI 配置已经足够好，可以继续使用。

## Desktop

如果你想体验完整的 Routa，桌面端是最佳起点：

- 工作区创建
- Provider 管理
- 会话与看板流程
- 团队协调
- 本地优先的存储与执行

### 安装

1. 打开 [GitHub Releases](https://github.com/phodal/routa/releases)。
2. 下载适用于你平台的最新 Desktop 构建版本。
3. 安装并启动 Routa Desktop。

### 首次运行

启动后：

1. 创建一个工作区。
2. 打开 `Providers`，让一个 Provider 可用。
3. 关联一个本地仓库，或从 GitHub 克隆一个仓库。
4. 从 `Session` 开始，让 Routa 检查你的仓库或为其规划工作。
5. 当你想要任务拆解和泳道自动化时，转到 `Kanban`。

### 为什么先用 Desktop

桌面端是最清晰的上手路径，因为它呈现了完整的产品模型，而不需要用户手动组装运行时。

## CLI

如果你常驻终端，并希望直接在现有代码仓库内使用 Routa，CLI 是最佳路径。

### 从 npm 安装

对大多数用户而言，这是最简单的 CLI 安装方式：

```bash
npm install -g routa-cli
```

检查安装：

```bash
routa --help
routa --version
```

### 从 Cargo 安装

如果你以 Rust 为先：

```bash
cargo install routa-cli
```

检查安装：

```bash
routa --help
routa --version
```

### 无需全局安装即可使用

如果你只想试用：

```bash
npx -p routa-cli routa --help
```

### 首批命令

最快的冒烟测试是一次性提示：

```bash
routa -p "Explain the architecture of this repository"
routa -p "Plan the next refactor for this codebase"
```

接下来有用的命令：

```bash
routa acp list
routa acp runtime-status
routa workspace list
routa team status --workspace-id default
```

### 为什么先用 CLI

在以下情况下，CLI 是最快的路径：

- 你已经在终端中打开了你的仓库
- 你想要一次性执行，而不是切换到 UI
- 你想要脚本化、自动化，或 ACP/运行时检查

## Web

Web 端是 Routa 的一等运行时界面，但它不是主要的“下载即用”路径。可以把它视为：

- 面向团队的自托管浏览器界面
- 当你想要浏览器访问时的内部部署目标
- 与桌面端共享领域语义的运行时

### 本地运行

```bash
npm install --legacy-peer-deps
npm run dev
```

打开 `http://localhost:3000`。

如果你想让 Web UI 指向本地的桌面端/后端服务器：

```bash
ROUTA_RUST_BACKEND_URL="http://127.0.0.1:3210" npm run dev
```

## 推荐

使用以下默认选择：

- 如果你想要产品化体验，选择 `Desktop`
- 如果你想要终端化体验，选择 `CLI`
- 如果你想要基于浏览器的访问或自托管部署，选择 `Web`

## 接下来该读什么

根据你想要做的事情选择下一页：

- 如果已完成配置并想了解工作流，阅读 [Use Routa](./use-routa)
- 如果模型或 Provider 尚未就绪，阅读 [Configuration](./configuration)
- 如果你仍在 Desktop、CLI 和 Web 之间做选择，阅读 [Platforms](./platforms)
- 如果你想要示例而非概念，阅读 [Use Routa](./use-routa/common-workflows)
- 如果你在评估近期变更，阅读 [What's New](./whats-new)

## 后续步骤

完成快速开始后：

- 阅读 [Use Routa](./use-routa)
- 阅读 [Configuration](./configuration)
- 如果你仍在选择使用界面，对比 [Platforms](./platforms)
- 阅读 [Use Routa](./use-routa/common-workflows)
- 阅读 [What's New](./whats-new)
