---
title: Web 端
---

# Web 端

当你希望通过浏览器访问 Routa，而不是使用打包好的桌面端应用时，Web 端是 Routa 的一等运行时载体。

## 何时使用 Web 端

- 自托管
- 为你自己的团队提供基于浏览器的访问
- 在内部部署中沿用与桌面端相同的工作区模型

## 本地运行

```bash
npm install --legacy-peer-deps
npm run dev
```

打开 `http://localhost:3000`。

如果你希望 Web UI 指向本地后端：

```bash
ROUTA_RUST_BACKEND_URL="http://127.0.0.1:3210" npm run dev
```

## 最佳适用场景

在以下情况下使用 Web 端：

- 你想要浏览器载体，而不是打包好的桌面端应用
- 为你自己的团队进行自托管部署
- 为相同的产品模型提供一个托管的内部入口

## 为什么 Web 端有所不同

我们有意将 Web 端描述为一种运行时载体，而不是默认的首次安装路径。如果你的目标是快速上手使用 Routa，请优先选择 [桌面端](/platforms/desktop) 或 [CLI](/platforms/cli)。

## 相关文档

- [快速开始](/quick-start)
- [管理](/administration)
- [配置](/configuration)
