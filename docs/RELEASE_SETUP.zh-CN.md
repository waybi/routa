# Routa CLI - 多平台发布配置

本文档总结了 Routa CLI 的完整发布配置，支持 **Cargo**、**NPM** 和 **GitHub Releases**。

## 概述

Routa CLI 现在可以同时发布到多个平台：

1. **crates.io** (Cargo) - 面向 Rust 用户
2. **npm** - 面向 Node.js 用户，提供预构建二进制文件
3. **GitHub Releases** - 直接下载二进制文件

## 快速开始

### 发布新版本

```bash
# Interactive mode
npm run release:publish

# Or specify version directly
./scripts/release/publish.sh 0.2.5

# Test first with dry run
./scripts/release/publish.sh 0.2.5 --dry-run
```

### 会发生什么？

1. **版本同步** - 更新所有包中的版本（Cargo.toml、package.json 等）
2. **提交并打标签** - 创建发布提交和 git 标签
3. **推送** - 触发 GitHub Actions
4. **自动发布**：
   - 按依赖顺序将所有 Rust crate 发布到 crates.io
   - 为 Linux、macOS（Intel/ARM）、Windows 构建二进制文件
   - 打包并发布到 npm
   - 创建包含桌面端二进制文件的 GitHub Release

## 安装方式

发布后，用户可以通过以下方式安装：

### 通过 Cargo
```bash
cargo install routa-cli
```

### 通过 NPM
```bash
npm install -g routa-cli
# or
npx -p routa-cli routa --help
```

### 通过 GitHub Release
从 [Releases 页面](https://github.com/phodal/routa/releases) 下载预构建二进制文件。

## 项目结构

### 发布脚本
- `scripts/release/publish.sh` - 交互式发布助手
- `scripts/release/sync-release-version.mjs` - 跨所有包的版本同步
- `scripts/release/stage-routa-cli-npm.mjs` - NPM 包暂存

### GitHub Actions 工作流
- `.github/workflows/release.yml` - 主发布编排
- `.github/workflows/cargo-release.yml` - 发布到 crates.io
- `.github/workflows/cli-release.yml` - 构建并发布到 npm
- `.github/workflows/tauri-release.yml` - 桌面端应用发布

### NPM 包结构
- `packages/routa-cli/` - 主 npm 包（平台检测封装）
- 平台特定包（构建期间自动生成）：
  - `routa-cli-linux-x64`
  - `routa-cli-darwin-x64`
  - `routa-cli-darwin-arm64`
  - `routa-cli-windows-x64`

### Rust Crate
按依赖顺序发布：
1. `routa-core` - 核心领域逻辑
2. `routa-rpc` - RPC 层
3. `routa-scanner` - 仓库扫描器
4. `routa-server` - HTTP 服务器
5. `routa-cli` - CLI 二进制文件

## 所需的 GitHub Secrets

在仓库设置中配置以下项：

- `CARGO_REGISTRY_TOKEN` - 来自 [crates.io/me](https://crates.io/me)
- `NPM_TOKEN` - 来自 [npmjs.com](https://www.npmjs.com/)（Automation token）
- `GITHUB_TOKEN` - 自动提供

## 文档

- [发布指南](./release-guide.md) - 详细的发布说明
- [发布检查清单](./RELEASE_CHECKLIST.md) - 快速检查清单
- [CLI README](https://github.com/phodal/routa/blob/main/crates/routa-cli/README.md) - CLI 使用文档
- [NPM README](https://github.com/phodal/routa/blob/main/packages/routa-cli/README.md) - NPM 包文档

## 版本管理

所有版本在以下位置保持同步：
- 根目录 `package.json`
- `Cargo.toml`（workspace）
- 所有 crate 的 `Cargo.toml` 文件
- `packages/routa-cli/package.json`
- `apps/desktop/package.json`
- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/tauri.conf.json`

`sync-release-version.mjs` 脚本会自动处理这一切。

## 触发方式

### 1. 推送 Git 标签（推荐）
```bash
git tag v0.2.5
git push origin main --tags
```

### 2. GitHub Actions 手动触发
前往 [Actions](https://github.com/phodal/routa/actions/workflows/release.yml) → 运行 workflow

### 3. 发布脚本
```bash
npm run release:publish
```

## 监控

监控发布进度：
- GitHub Actions: https://github.com/phodal/routa/actions
- crates.io: https://crates.io/crates/routa-cli
- npm: https://www.npmjs.com/package/routa-cli
- GitHub Releases: https://github.com/phodal/routa/releases

## 故障排查

常见问题及解决方案请参阅[发布指南](docs/release-guide.md)。

## 后续步骤

首次发布后：
1. 用最新版本更新 README 徽章
2. 在社区渠道发布发布公告
3. 如有需要，更新文档
4. 监控用户反馈

---

如需详细说明，请参阅 [release-guide.md](./release-guide.md)。
