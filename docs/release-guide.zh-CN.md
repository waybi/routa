# Routa 发布指南

本指南介绍将 Routa 新构件发布到多个分发渠道的流程：**crates.io**（Cargo）、**npm** 和 **GitHub Releases**。

## 概述

发布流程会同时发布到三个渠道：

1. **crates.io** —— Rust 用户可以执行 `cargo install routa-cli`、`cargo install harness-monitor` 和 `cargo install entrix`
2. **npm** —— Node.js 用户可以执行 `npm install -g routa-cli`、`npm install -g harness-monitor` 和 `npm install -g entrix`
3. **GitHub Releases** —— 桌面端二进制文件和发布说明

## 前置条件

### 仓库密钥

请确保已配置以下 GitHub secrets：

- `CRATE_TOKEN` —— 从 [crates.io/me](https://crates.io/me) → API Tokens 获取（注意：工作流使用的是 `CRATE_TOKEN`，而非 `CARGO_REGISTRY_TOKEN`）
- `NPM_TOKEN` —— 从 [npmjs.com](https://www.npmjs.com/) → Access Tokens → Generate New Token → Automation 获取
- `ROUTA_GITHUB_TOKEN` —— 针对 GitHub Actions API 获取发布基线时优先使用的 token
- `GITHUB_TOKEN` —— 由 GitHub Actions 自动提供，在未配置 `ROUTA_GITHUB_TOKEN` 时作为回退使用

### 本地准备

```bash
# 确保你在 main 分支并拉取了最新代码
git checkout main
git pull origin main

# 确认没有未提交的更改
git status
```

## 发布方式

### 方式 1：自动化脚本（推荐）

使用发布辅助脚本：

```bash
# 交互模式 —— 提示输入版本号
./scripts/release/publish.sh

# 直接模式 —— 指定版本号
./scripts/release/publish.sh 0.2.5

# 试运行 —— 测试但不实际发布
./scripts/release/publish.sh 0.2.5 --dry-run
```

该脚本将会：
1. 在所有包之间同步版本号
2. 在 `dist/release/release-notes.md` 下生成发布说明预览
3. 向你展示这些更改
4. 创建提交和标签
5. 推送以触发 GitHub Actions

### 方式 1.5：准备发布构件和博客草稿

如果你想在决定是否发布之前先把发布说明/博客文件写入 `docs/releases/`，请使用准备辅助命令：

```bash
# 准备发布说明、变更日志以及 docs/releases 博客草稿
npm run release:prepare -- 0.2.5

# 使用指定的范围并生成 AI 摘要
npm run release:prepare -- 0.2.5 --from v0.2.4 --ai --ai-provider claude
```

该辅助命令会：
1. 在整个仓库中同步版本字段
2. 在 `dist/release/` 下生成预览文件
3. 将生成的发布说明复制到 `docs/releases/v<version>-release-notes.md`
4. 将技术变更日志复制到 `docs/releases/v<version>-changelog.md`
5. 把提交、打标签和推送的决定留到后续的显式步骤

如果你使用的是仓库的 skill 系统，可以通过 `.agents/skills/release/` 使用相同的工作流。

### 生成发布说明

Tauri 草稿发布使用从提交派生的发布说明。在发布前，可在本地生成相同的 markdown：

```bash
npm run release:changelog -- \
  --from v0.2.5 \
  --to v0.2.6 \
  --out dist/release/release-notes.md \
  --changelog-out dist/release/CHANGELOG.generated.md
```

对于混合工作流，先生成 AI 提示词包，向内置专家请求一份精编的 `summaryMarkdown`，然后用该精编摘要重新运行变更日志生成：

```bash
# 确定性的技术变更日志 + 提示词包
npm run release:changelog -- \
  --from v0.2.5 \
  --to v0.2.6 \
  --prompt-out dist/release/changelog-summary-prompt.json \
  --changelog-out dist/release/CHANGELOG.generated.md \
  --out dist/release/release-notes.md

# 可选的一步式专家运行；需要已配置的 ACP provider
npm run release:changelog -- \
  --from v0.2.5 \
  --to v0.2.6 \
  --ai \
  --ai-provider claude \
  --out dist/release/release-notes.md \
  --changelog-out dist/release/CHANGELOG.generated.md
```

生成的发布说明包含面向用户的 `Summary`、技术变更日志、提交链接、安装说明以及范围元数据。`--changelog-out` 会将相同的标签范围写为一份独立的 `# Changelog` 条目。如果你想手动精编而不运行专家，可以用 Markdown 撰写精编摘要，并通过 `--summary-file` 传入。

### 方式 2：手动流程

```bash
# 1. 更新所有包中的版本号
node scripts/release/sync-release-version.mjs --version 0.2.5

# 2. 审查更改
git diff

# 3. 提交并打标签
git commit -am "chore: release v0.2.5"
git tag v0.2.5

# 4. 推送
git push origin main --tags
```

### 方式 3：GitHub UI 手动触发

从 GitHub 手动触发：

1. 前往 [Actions](https://github.com/phodal/routa/actions/workflows/release.yml)
2. 点击 “Run workflow”
3. 输入版本号（例如 `0.2.5` 或 `v0.2.5`）
4. 配置发布选项：
   - `publish_cargo`：发布到 crates.io
   - `publish_cli`：发布 npm 包
   - `publish_desktop`：创建包含桌面端二进制文件的 GitHub Release
   - `dry_run`：测试但不实际发布

## 发布工作流

一旦你推送了标签（例如 `v0.2.5`），GitHub Actions 会自动执行：

### 1. Cargo 发布（`.github/workflows/cargo-release.yml`）

按以下顺序发布这些 crate：
1. `routa-core` —— 核心领域逻辑
2. `routa-rpc` —— RPC 层
3. `routa-scanner` —— 仓库扫描器
4. `routa-server` —— HTTP 服务器
5. `entrix` —— Harness Monitor 共用的 Entrix 适应度引擎
6. `routa-cli` —— CLI 二进制文件
7. `harness-monitor` —— 终端监视与归因工具

**注意**：每个 crate 在发布前都会等待前一个 crate 在 crates.io 上完成索引。

### 2. CLI 发布（`.github/workflows/cli-release.yml`）

构建特定平台的二进制文件：
- `linux-x64` —— Linux x86_64
- `darwin-x64` —— macOS Intel
- `darwin-arm64` —— macOS Apple Silicon
- `win32-x64` —— Windows x64

然后以如下名称发布到 npm：
- `routa-cli` —— 带平台检测的主包
- `routa-cli-linux-x64` —— Linux 二进制文件
- `routa-cli-darwin-x64` —— macOS Intel 二进制文件
- `routa-cli-darwin-arm64` —— macOS ARM 二进制文件
- `routa-cli-windows-x64` —— Windows 二进制文件

### 3. 桌面端发布（`.github/workflows/tauri-release.yml`）

创建包含以下内容的 GitHub Release：
- 适用于 macOS、Linux 和 Windows 的 Tauri 桌面应用安装包
- 由 `scripts/release/generate-changelog.mjs` 自动生成的发布说明
- CLI 安装说明
- macOS 的自动代码签名（如已配置）

**平台矩阵**：
- `macos-latest` —— 为 Intel 和 Apple Silicon 构建 `.dmg` 和 `.app`
- `ubuntu-22.04` —— 为 Linux 构建 `.deb` 和 `.AppImage`
- `windows-latest` —— 为 Windows 构建 `.msi` 和 `.exe`

**重要**：桌面端发布要求所有版本字段保持同步：
- `apps/desktop/package.json`
- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/tauri.conf.json`

如果 Tauri 报错 `version must be a semver string`，请检查这三个文件的版本是否一致。

## 验证

发布完成后（约 15-30 分钟），请验证：

### Crates.io
```bash
cargo search routa-cli
cargo install routa-cli@0.2.5
routa --version

cargo search harness-monitor
cargo install harness-monitor@0.2.5
harness-monitor --version
```

### NPM
```bash
npm view routa-cli versions
npm install -g routa-cli@0.2.5
routa --version
```

### GitHub Release
在 [Releases 页面](https://github.com/phodal/routa/releases) 检查新版本。

## 故障排查

### crates.io 上版本已发布

如果某个 crate 版本已存在于 crates.io，工作流会跳过它并继续。对于补丁版本的重新发布，这是正常现象。

### NPM 发布失败

检查 `NPM_TOKEN` 是否有效：
- token 必须具有 “Automation” 访问权限
- token 不得过期
- 你必须是 `routa-cli` npm 组织的维护者

**已知问题**：即使平台子包发布成功，主 `routa-cli` 包也可能未被发布。如果发生这种情况：

1. 手动将 `packages/routa-cli/package.json` 的 optionalDependencies 更新到新版本
2. 手动发布：
   ```bash
   cd packages/routa-cli
   npm publish --access public
   ```

**根本原因**：`stage-routa-cli-npm.mjs` 脚本缺少主包的暂存逻辑（已在 v0.2.9+ 中修复）。

### Cargo 发布失败

常见问题：
- **缺少依赖版本**：确保所有 workspace crate 使用相同的版本
- **API token 过期**：在 [crates.io/settings/tokens](https://crates.io/settings/tokens) 重新生成 token
- **网络超时**：重新运行工作流
- **密钥名称错误**：工作流期望的是 `CRATE_TOKEN`，而非 `CARGO_REGISTRY_TOKEN`

**已知问题**：Cargo crate 可能不会被自动发布。如果发生这种情况：

1. 手动更新所有发布 crate 的版本：
   ```bash
   for crate in crates/routa-core crates/routa-rpc crates/routa-scanner crates/routa-server crates/entrix crates/routa-cli crates/harness-monitor; do
     sed -i '' 's/version = "OLD_VERSION"/version = "NEW_VERSION"/g' "$crate/Cargo.toml"
   done
   ```

2. 按依赖顺序发布：
   ```bash
   cargo login YOUR_CRATE_TOKEN
   cd crates/routa-core && cargo publish --no-verify
   cd ../routa-rpc && cargo publish --no-verify
   cd ../routa-scanner && cargo publish --no-verify
   cd ../routa-server && cargo publish --no-verify
   cd ../entrix && cargo publish --no-verify
   cd ../routa-cli && cargo publish --no-verify
   cd ../harness-monitor && cargo publish --no-verify
   ```

**根本原因**：`sync-release-version.mjs` 脚本不会同步 Rust crate 版本（仅同步桌面端 Tauri 和 npm 包）。

## 版本递增类型

遵循[语义化版本](https://semver.org/)：

- **补丁版本（Patch）**（0.2.4 → 0.2.5）：缺陷修复，无破坏性更改
- **次要版本（Minor）**（0.2.5 → 0.3.0）：新功能，向后兼容
- **主要版本（Major）**（0.3.0 → 1.0.0）：破坏性更改

## 回滚

如果你需要回滚一次发布：

```bash
# 在本地和远端删除标签
git tag -d v0.2.5
git push origin :refs/tags/v0.2.5
```

**注意**：你无法从 crates.io 撤销发布（unpublish），但可以撤回（yank）某个版本：

```bash
cargo yank routa-cli@0.2.5
```

## 已知问题与注意事项

### 1. 主发布工作流不会触发 Cargo 发布

**问题**：`.github/workflows/release.yml` 不会调用 `cargo-release.yml`，因此 Rust crate 不会被自动发布。

**临时方案**：手动触发 Cargo 发布工作流，或按 “故障排查 > Cargo 发布失败” 中的说明在本地发布。

**永久修复**：在主发布工作流中添加 Cargo 发布作业。

### 2. 版本同步脚本不完整

**问题**：`scripts/release/sync-release-version.mjs` 只会同步：
- 桌面端：`apps/desktop/package.json`、`apps/desktop/src-tauri/Cargo.toml`、`apps/desktop/src-tauri/tauri.conf.json`
- CLI npm：`packages/routa-cli/package.json`

它**不会**同步：
- Rust crate：`crates/*/Cargo.toml`
- CLI npm 的 optionalDependencies 版本

**临时方案**：按 “故障排查” 中的说明手动更新 Rust crate 版本和 npm optionalDependencies。

**永久修复**：扩展 `sync-release-version.mjs` 以处理所有版本字段。

### 3. CLI 构件命名约定

**问题**：构建作业必须使用一致的构件名称（不带版本字符串），以便暂存作业能够找到它们。

**修复于**：v0.2.9 —— 构件名称已标准化为 `routa-cli-{platform}` 格式。

### 4. Windows PowerShell 与 Bash 的差异

**问题**：Windows runner 默认使用 PowerShell，它处理 `${RELEASE_VERSION}` 环境变量的方式与 bash 不同，会导致版本解析错误。

**修复于**：v0.2.9 —— 所有版本同步步骤现在都显式使用 `shell: bash`。

### 5. macOS Bash 3 兼容性

**问题**：macOS runner 使用 Bash 3.x，不支持 `mapfile` 命令。

**修复于**：v0.2.9 —— 已将 `mapfile` 替换为 `while read` 循环。

## 相关文档

- [Cargo.toml workspace 配置](https://github.com/phodal/routa/blob/main/Cargo.toml)
- [NPM 包结构](https://github.com/phodal/routa/blob/main/packages/routa-cli/package.json)
- [CLI 发布工作流](https://github.com/phodal/routa/blob/main/.github/workflows/cli-release.yml)
- [Cargo 发布工作流](https://github.com/phodal/routa/blob/main/.github/workflows/cargo-release.yml)
- [桌面端发布工作流](https://github.com/phodal/routa/blob/main/.github/workflows/tauri-release.yml)
- [发布检查清单](https://github.com/phodal/routa/blob/main/docs/RELEASE_CHECKLIST.md)
