# 发布检查清单

发布 Routa 的快速检查清单。

## 前置条件

- [ ] 所有测试通过
- [ ] 没有未提交的更改
- [ ] 处于 `main` 分支且代码为最新
- [ ] 已配置 GitHub secrets：
  - `CRATE_TOKEN`（来自 crates.io — 注意：不是 `CARGO_REGISTRY_TOKEN`）
  - `NPM_TOKEN`（来自 npmjs.com）
  - `ROUTA_GITHUB_TOKEN`（用于发布基线拉取的首选项）

## 发布步骤

### 方式一：自动化脚本（推荐）

```bash
# 交互式
npm run release:publish

# 或直接执行
./scripts/release/publish.sh 0.2.5

# 先做一次试运行
./scripts/release/publish.sh 0.2.5 --dry-run
```

### 方式二：手动

```bash
# 1. 同步版本号
npm run release:sync-version -- --version 0.2.5

# 2. 检查更改
git diff

# 3. 提交并打标签
git commit -am "chore: release v0.2.5"
git tag v0.2.5

# 4. 推送
git push origin main --tags
```

## 发布后

- [ ] 监控 [GitHub Actions](https://github.com/phodal/routa/actions)
- [ ] 验证 crates.io 发布情况（全部 7 个 crate）：
  - [ ] [routa-core](https://crates.io/crates/routa-core)
  - [ ] [routa-rpc](https://crates.io/crates/routa-rpc)
  - [ ] [routa-scanner](https://crates.io/crates/routa-scanner)
  - [ ] [routa-server](https://crates.io/crates/routa-server)
  - [ ] [routa-cli](https://crates.io/crates/routa-cli)
  - [ ] [entrix](https://crates.io/crates/entrix)
  - [ ] [harness-monitor](https://crates.io/crates/harness-monitor)
- [ ] 验证 npm 发布情况（全部 15 个包）：
  - [ ] [routa-cli](https://www.npmjs.com/package/routa-cli)（主包）
  - [ ] [routa-cli-linux-x64](https://www.npmjs.com/package/routa-cli-linux-x64)
  - [ ] [routa-cli-darwin-arm64](https://www.npmjs.com/package/routa-cli-darwin-arm64)
  - [ ] [routa-cli-darwin-x64](https://www.npmjs.com/package/routa-cli-darwin-x64)
  - [ ] [routa-cli-windows-x64](https://www.npmjs.com/package/routa-cli-windows-x64)
  - [ ] [harness-monitor](https://www.npmjs.com/package/harness-monitor)（主包）
  - [ ] [harness-monitor-linux-x64](https://www.npmjs.com/package/harness-monitor-linux-x64)
  - [ ] [harness-monitor-darwin-arm64](https://www.npmjs.com/package/harness-monitor-darwin-arm64)
  - [ ] [harness-monitor-darwin-x64](https://www.npmjs.com/package/harness-monitor-darwin-x64)
  - [ ] [harness-monitor-windows-x64](https://www.npmjs.com/package/harness-monitor-windows-x64)
  - [ ] [entrix](https://www.npmjs.com/package/entrix)（主包）
  - [ ] [entrix-linux-x64](https://www.npmjs.com/package/entrix-linux-x64)
  - [ ] [entrix-darwin-arm64](https://www.npmjs.com/package/entrix-darwin-arm64)
  - [ ] [entrix-darwin-x64](https://www.npmjs.com/package/entrix-darwin-x64)
  - [ ] [entrix-windows-x64](https://www.npmjs.com/package/entrix-windows-x64)
- [ ] 验证 [GitHub Release](https://github.com/phodal/routa/releases)（桌面端安装包）
- [ ] 测试安装：
  ```bash
  cargo install routa-cli@0.2.9
  cargo install harness-monitor@0.2.9
  cargo install entrix@0.2.9
  npm install -g routa-cli@0.2.9
  npm install -g harness-monitor@0.2.9
  npm install -g entrix@0.2.9
  routa --version  # 应显示新版本号
  harness-monitor --version
  entrix --version
  ```

## 回滚

如有需要：

```bash
# 删除标签
git tag -d v0.2.5
git push origin :refs/tags/v0.2.5

# 从 crates.io 撤回（无法取消发布）
cargo yank routa-cli@0.2.5
cargo yank harness-monitor@0.2.5
```

## 完整文档

详细说明请参见 [docs/release-guide.md](./release-guide.md)。
