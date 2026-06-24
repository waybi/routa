---
title: 自托管
---

# 自托管

Routa 可以作为打包好的桌面端应用使用，但其 Web/运行时层也可以在你
自己的环境中运行。

## 自托管目前意味着什么

目前，自托管主要是指运行 Next.js Web 层，并在需要时将其
接入本地或远程的后端/运行时。

## 基础本地流程

从源码运行 Web 层：

```bash
npm install --legacy-peer-deps
npm run dev
```

打开 `http://localhost:3000`。

如果你希望 Web UI 指向本地后端：

```bash
ROUTA_RUST_BACKEND_URL="http://127.0.0.1:3210" npm run dev
```

## 运维注意事项

主要需要考虑的事项包括：

- 哪些 Provider 路径可用
- 设置了哪些环境变量
- Web UI 是否能访问到后端/运行时层
- 在需要时，基于 Docker 的执行路径是否可用

## 目前尚未覆盖的内容

当前仓库中的发布与贡献者文档比完整的公开生产环境自托管运行手册更为完善。
请将本页视为运维入口，而非完整的托管
手册。

## 继续阅读

- [Configuration](/configuration)
- [Deployment](/deployment)
- [Release Guide](/release-guide)
