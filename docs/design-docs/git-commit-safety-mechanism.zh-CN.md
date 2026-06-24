---
title: Git 提交安全机制
---

# Git 提交安全机制

**日期**: 2026-04-06  
**状态**: 设计  
**上下文**: 防止测试凭据泄漏到生产提交

## 问题分析

### 根因

1. **应用层**: `git_commit` 工具没有校验凭据
2. **测试层**: 测试仓库与生产仓库共享了凭据命名空间
3. **仓库层**: 没有 pre-commit hook 阻止可疑提交
4. **CI/CD 层**: 流水线没有校验提交元数据
5. **监控层**: 合并后没有检测可疑提交

### 攻击面

```
┌─────────────────────────────────────────────────────────────┐
│ How Test Credentials Can Leak                              │
├─────────────────────────────────────────────────────────────┤
│ 1. AI Agent uses git_commit tool in wrong directory        │
│ 2. Test runs in production repo directory                  │
│ 3. Test crashes without cleanup, leaves git config         │
│ 4. Developer manually runs test code in production repo    │
│ 5. Worktree created from test template                     │
│ 6. Git config --global accidentally set during tests       │
└─────────────────────────────────────────────────────────────┘
```

## 纵深防御策略

```
Layer 1: Prevention (Before Commit)
Layer 2: Detection (At Commit Time)
Layer 3: Rejection (Pre-Push)
Layer 4: Validation (CI/CD)
Layer 5: Monitoring (Post-Merge)
```

## 第 1 层：预防（提交前）

### 1.1 应用级校验（已实现）

**文件**: `src/core/tools/workspace-tools.ts`

```typescript
// Validate before every commit
- Block test@example.com
- Block "Routa Test", "Test", "placeholder"
- Require valid git identity
```

### 1.2 测试框架隔离

**原则**: 测试绝不应该触碰生产 Git 配置。

```rust
// Enforce test isolation pattern
pub struct IsolatedGitRepo {
    _temp_dir: TempDir,
    pub path: PathBuf,
}

impl IsolatedGitRepo {
    pub fn new() -> Self {
        let temp_dir = TempDir::new().unwrap();
        let path = temp_dir.path().to_path_buf();

        // Initialize with LOCAL config only
        run_git(&path, &["init"]);
        run_git(&path, &["config", "--local", "user.name", "Routa Test"]);
        run_git(&path, &["config", "--local", "user.email", "test@example.com"]);

        Self { _temp_dir: temp_dir, path }
    }

    // Prevent access to production repo
    pub fn assert_isolated(&self) {
        assert!(self.path.starts_with(std::env::temp_dir()));
    }
}
```

### 1.3 环境检测

```typescript
// Detect if running in test context
function isTestEnvironment(): boolean {
    return (
        process.env.NODE_ENV === 'test' ||
        process.env.VITEST === 'true' ||
        process.env.JEST_WORKER_ID !== undefined ||
        // Rust test detection
        process.env.CARGO_TEST === 'true'
    );
}

// Block test credentials in production context
async function validateGitCommitContext(cwd: string) {
    if (!isTestEnvironment() && isTestCredential(cwd)) {
        throw new Error(
            'Test credentials detected in production environment. ' +
            'This indicates a test isolation failure.'
        );
    }
}
```

## 第 2 层：检测（提交时）

### 2.1 Git Pre-Commit Hook

**文件**: `.husky/pre-commit`

```bash
#!/usr/bin/env sh

# Validate commit author before allowing commit
AUTHOR_NAME=$(git config user.name)
AUTHOR_EMAIL=$(git config user.email)

# Block test credentials
if echo "$AUTHOR_EMAIL" | grep -qi "test@example.com"; then
    echo "❌ COMMIT BLOCKED: Test email detected"
    echo "   Found: $AUTHOR_EMAIL"
    echo ""
    echo "   Configure your real git identity:"
    echo "   git config user.name "Your Name""
    echo "   git config user.email "your.email@example.com""
    exit 1
fi

if echo "$AUTHOR_NAME" | grep -qi "routa test"; then
    echo "❌ COMMIT BLOCKED: Test name detected"
    echo "   Found: $AUTHOR_NAME"
    exit 1
fi

# Require valid email format
if ! echo "$AUTHOR_EMAIL" | grep -qE "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+.[a-zA-Z]{2,}$"; then
    echo "❌ COMMIT BLOCKED: Invalid email format"
    echo "   Found: $AUTHOR_EMAIL"
    exit 1
fi
```

### 2.2 提交消息校验

源文档在此处保留为空白占位。后续可以补充对 bypass 理由、issue 引用和异常上下文的提交消息校验规则。

## 第 3 层：拒绝（推送前）

### 3.1 Git Pre-Push Hook

**文件**: `.husky/pre-push`

```bash
#!/usr/bin/env sh

# Scan all commits being pushed for suspicious authors
REMOTE="$1"
URL="$2"

# Get list of commits to be pushed
while read local_ref local_sha remote_ref remote_sha; do
    if [ "$local_sha" != "0000000000000000000000000000000000000000" ]; then
        # Check commits from remote_sha to local_sha
        RANGE="$remote_sha..$local_sha"

        # Find commits with test credentials
        SUSPICIOUS=$(git log "$RANGE" --format="%H %ae %an" |             grep -iE "(test@example.com|routa test)" || true)

        if [ -n "$SUSPICIOUS" ]; then
            echo "❌ PUSH BLOCKED: Commits with test credentials detected"
            echo ""
            echo "$SUSPICIOUS" | while read hash email name; do
                echo "  Commit: $hash"
                echo "  Author: $name <$email>"
                echo ""
            done
            echo "Fix these commits before pushing:"
            echo "  git rebase -i origin/main"
            echo "  # Mark commits for 'edit', then:"
            echo "  git commit --amend --author="Your Name <your@email.com>""
            exit 1
        fi
    fi
done

echo "✅ Push validation passed"
```

### 3.2 服务端 Pre-Receive Hook

对于自托管仓库，增加服务端校验：

```bash
#!/bin/bash
# .git/hooks/pre-receive (on server)

while read oldrev newrev refname; do
    # Scan all commits in push
    for commit in $(git rev-list $oldrev..$newrev); do
        AUTHOR_EMAIL=$(git log -1 --format=%ae $commit)
        AUTHOR_NAME=$(git log -1 --format=%an $commit)

        if echo "$AUTHOR_EMAIL" | grep -qi "test@example.com"; then
            echo "ERROR: Push rejected - commit $commit has test email"
            exit 1
        fi

        if echo "$AUTHOR_NAME" | grep -qi "routa test"; then
            echo "ERROR: Push rejected - commit $commit has test name"
            exit 1
        fi
    done
done
```

## 第 4 层：CI/CD 校验

### 4.1 GitHub Actions 校验

**文件**: `.github/workflows/defense.yml`

```yaml
jobs:
  validate-commit-metadata:
    name: "Validate Commit Metadata"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Full history

      - name: Check for test credentials in commits
        run: |
          # Check all commits in PR
          BASE_SHA="${{ github.event.pull_request.base.sha }}"
          HEAD_SHA="${{ github.event.pull_request.head.sha }}"

          if [ -n "$BASE_SHA" ]; then
            RANGE="$BASE_SHA..$HEAD_SHA"
          else
            RANGE="HEAD~10..HEAD"  # Last 10 commits for push
          fi

          echo "Checking commits in range: $RANGE"

          SUSPICIOUS=$(git log "$RANGE" --format="%H %ae %an" |             grep -iE "(test@example.com|routa test|placeholder)" || true)

          if [ -n "$SUSPICIOUS" ]; then
            echo "❌ Test credentials found in commits:"
            echo "$SUSPICIOUS"
            exit 1
          fi

          echo "✅ All commits have valid author metadata"

      - name: Validate email domains
        run: |
          # Optional: enforce company email domain
          INVALID=$(git log "$RANGE" --format="%ae" |             grep -vE "@(gmail|github|users.noreply.github|phodal).com$" || true)

          if [ -n "$INVALID" ]; then
            echo "⚠️  Warning: Unexpected email domains: $INVALID"
            # Don't fail, just warn
          fi
```

### 4.2 合并前校验

```yaml
  block-merge-if-test-credentials:
    name: "Block Merge - Test Credentials"
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4

      - name: Scan PR commits
        id: scan
        run: |
          # More strict for PR merge
          if git log origin/${{ github.base_ref }}..${{ github.sha }}              --format="%ae %an" | grep -qiE "(test@example|routa test)"; then
            echo "has_test_creds=true" >> $GITHUB_OUTPUT
          else
            echo "has_test_creds=false" >> $GITHUB_OUTPUT
          fi

      - name: Block merge
        if: steps.scan.outputs.has_test_creds == 'true'
        run: |
          echo "::error::PR contains commits with test credentials"
          echo "::error::These commits must be amended before merge"
          exit 1
```

## 第 5 层：监控与告警

### 5.1 合并后检测

```typescript
// scripts/check-commit-history.ts
import { execSync } from 'child_process';

async function scanRecentCommits(days = 7) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const commits = execSync(
        `git log --since="${since.toISOString()}" --format="%H|%ae|%an"`,
        { encoding: 'utf-8' }
    ).trim().split('
');

    const suspicious = commits.filter(line => {
        const [hash, email, name] = line.split('|');
        return (
            email.includes('test@example.com') ||
            name.toLowerCase().includes('routa test') ||
            name.toLowerCase() === 'test'
        );
    });

    if (suspicious.length > 0) {
        await sendAlert({
            severity: 'HIGH',
            title: 'Test credentials detected in git history',
            commits: suspicious,
            action: 'Review and amend commits immediately'
        });
    }
}
```

### 5.2 每日计划检查

**文件**: `.github/workflows/daily-health-check.yml`

```yaml
name: Daily Repository Health Check

on:
  schedule:
    - cron: '0 2 * * *'  # 2 AM daily
  workflow_dispatch:

jobs:
  check-git-history:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Scan last 30 days for test credentials
        run: |
          SUSPICIOUS=$(git log --since="30 days ago" --format="%H %ae %an" |             grep -iE "(test@example.com|routa test)" || true)

          if [ -n "$SUSPICIOUS" ]; then
            echo "⚠️  Test credentials found in recent history:"
            echo "$SUSPICIOUS"

            # Create GitHub issue
            gh issue create               --title "🚨 Test credentials detected in git history"               --body "Found commits with test credentials in last 30 days"               --label "security,git-hygiene"
          fi
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## 实现路线图

### 阶段 1：立即处理（已完成）

- ✅ 在 `git_commit` 工具中做应用级校验
- ✅ 使用 `--local` config 实现测试隔离
- ✅ 使用 `TempDir` 做 RAII 清理

### 阶段 2：Git Hooks（高优先级）

- [ ] 添加 pre-commit hook 阻止测试凭据
- [ ] 添加 pre-push hook 扫描提交历史
- [ ] 使用校验逻辑更新 `.husky/` hooks

### 阶段 3：CI/CD Gates（高优先级）

- [ ] 在 Defense workflow 中添加提交元数据校验
- [ ] 添加 PR 合并前校验
- [ ] 如果检测到测试凭据，则阻止合并

### 阶段 4：监控（中优先级）

- [ ] 每日计划健康检查
- [ ] 对可疑提交发出告警
- [ ] 对违规自动创建 issue

### 阶段 5：测试框架（中优先级）

- [ ] 在 Rust 中创建 `IsolatedGitRepo` helper
- [ ] 在 TypeScript 中创建 `createTestRepo()` helper
- [ ] 在测试指南中强制使用

## 配置

### 阻止模式

**文件**: `scripts/git-safety-config.json`

```json
{
  "blockedEmails": [
    "test@example.com",
    "noreply@test.com",
    "placeholder@example.com"
  ],
  "blockedNames": [
    "routa test",
    "test",
    "placeholder",
    "example user"
  ],
  "allowedDomains": [
    "gmail.com",
    "github.com",
    "users.noreply.github.com"
  ],
  "strictMode": false
}
```

## 测试安全机制

### 手工测试

```bash
# 1. Try to commit with test credentials
cd /tmp
mkdir test-safety
cd test-safety
git init
git config --local user.name "Routa Test"
git config --local user.email "test@example.com"
echo "test" > file.txt
git add file.txt
git commit -m "test"  # Should be BLOCKED by pre-commit hook

# 2. Try to use git_commit tool with test creds
# Should fail with validation error
```

### 自动化测试

```typescript
// tests/git-safety.test.ts
describe('Git Safety Mechanism', () => {
    it('blocks commits with test email', async () => {
        const tempRepo = createTempRepo();
        await execAsync('git config --local user.email test@example.com', { cwd: tempRepo });

        await expect(
            commitTool.execute({ message: 'test', cwd: tempRepo })
        ).rejects.toThrow('suspicious test value');
    });

    it('blocks commits with test name', async () => {
        const tempRepo = createTempRepo();
        await execAsync('git config --local user.name "Routa Test"', { cwd: tempRepo });

        await expect(
            commitTool.execute({ message: 'test', cwd: tempRepo })
        ).rejects.toThrow('suspicious test value');
    });
});
```

## 指标与 KPI

跟踪安全机制的有效性：

- **pre-commit 阶段阻止的提交**: 本地阻止次数
- **pre-push 阶段阻止的提交**: 推送阻止次数
- **因凭据导致的 CI 失败**: CI 阻断次数
- **泄漏事故**: main 分支中出现测试凭据的次数
- **平均检测时间**: 从提交到检测的时间
- **平均修复时间**: 从检测到修复的时间

**目标**: 实现后 main 分支历史中测试凭据数量为零。

## 应急响应

如果在 main 中检测到测试凭据：

1. **立即**: 创建 incident issue
2. **评估**: 确定范围（多少提交、哪些分支）
3. **决策**: 重写历史，或接受现状并继续前进
4. **修复**: 如果重写历史，需要与所有贡献者协调
5. **预防**: 确保所有防护层都已启用
6. **复盘**: 通过 post-mortem 加强机制

## 总结

这种纵深防御方法提供 **5 层保护**：

1. ✅ **预防**: 应用在提交前校验
2. 🔄 **检测**: Git hooks 在提交时阻止
3. 🔄 **拒绝**: Pre-push hooks 扫描历史
4. 🔄 **校验**: CI/CD 在流水线中强制执行
5. 🔄 **监控**: 每日扫描检测逃逸问题

**关键原则**: 让测试凭据不可能进入生产，而不仅仅是降低概率。

## 参考

- Issue: `docs/issues/2026-04-06-test-git-credentials-leak.md`
- 实现: Commits a75a2901, 160c9600
- Git Hooks: `.husky/pre-commit`, `.husky/pre-push`
- CI/CD: `.github/workflows/defense.yml`
