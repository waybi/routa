---
title: 文件删除安全机制
---

# 文件删除安全机制

**日期**: 2026-04-06  
**状态**: 设计 + 实现  
**目的**: 防止提交中意外出现大规模文件删除（200+ 个文件）

## 问题陈述

AI Agent 或人为失误可能会意外删除大量文件：

- 重构出错
- `rm -rf` 命令路径错误
- 目录结构重组失误
- 对 Git 操作理解错误（例如 `git rm -r .`）

**风险**: 如果合并到生产分支，可能造成灾难性数据丢失。

## 设计目标

1. **阻止** 大规模删除（200+ 个文件）被提交
2. **允许** 合法的大规模删除，但必须显式确认
3. **提供** 清晰的违规修复指引
4. **在多层检测**（pre-commit、pre-push、CI/CD）

## 阈值决策

**选定阈值：200 个文件**

理由：

- 常规重构：通常少于 50 个文件
- 功能移除：通常少于 100 个文件
- 目录重组：50-150 个文件
- 大规模误删事故：通常 500+ 个文件

200 个文件在允许合法操作的同时提供了安全余量。

## 实现策略

### 第 1 层：Pre-Commit Hook

**时机**: `git commit` 创建 commit object 之前  
**内容**: 统计暂存区中被删除的文件数量  
**动作**: 如果数量大于等于 200，则阻止提交

```bash
# In .husky/pre-commit

# Count deleted files in staging area
DELETED_COUNT=$(git diff --cached --diff-filter=D --name-only | wc -l | tr -d ' ')

if [ "$DELETED_COUNT" -ge 200 ]; then
    echo "❌ COMMIT BLOCKED: Mass file deletion detected"
    echo "   Deleted files: $DELETED_COUNT"
    echo "   Threshold: 200 files"
    echo ""
    echo "   If this is intentional, use one of these options:"
    echo "   1. Split into smaller commits (recommended)"
    echo "   2. Use: ALLOW_MASS_DELETE=1 git commit ..."
    echo "   3. Document reason in commit message"
    exit 1
fi
```

### 第 2 层：Pre-Push Hook

**时机**: `git push` 将提交发送到远端之前  
**内容**: 扫描即将推送的所有提交，检查是否存在大规模删除  
**动作**: 如果任一提交删除了 200+ 个文件，则阻止推送

```bash
# In .husky/pre-push

while read local_ref local_sha remote_ref remote_sha; do
    RANGE="$remote_sha..$local_sha"
    
    # Check each commit in the push
    for commit in $(git rev-list $RANGE); do
        DELETED=$(git show --diff-filter=D --name-only --format="" $commit | wc -l)
        
        if [ "$DELETED" -ge 200 ]; then
            echo "❌ PUSH BLOCKED: Commit $commit deletes $DELETED files"
            echo "   Threshold: 200 files"
            exit 1
        fi
    done
done
```

### 第 3 层：CI/CD 校验

**时机**: Pull Request 或 push 到 main 时  
**内容**: 校验 PR/push 中的所有提交  
**动作**: 如果检测到大规模删除，则让 CI 失败

```yaml
# In .github/workflows/defense.yaml

validate-file-deletions:
  name: 'Gate: File Deletion Safety'
  steps:
    - name: Check for mass file deletions
      run: |
        RANGE="${{ github.event.pull_request.base.sha }}...${{ github.event.pull_request.head.sha }}"
        
        for commit in $(git rev-list $RANGE); do
          DELETED=$(git show --diff-filter=D --name-only --format="" $commit | wc -l)
          
          if [ "$DELETED" -ge 200 ]; then
            echo "::error::Commit $(echo $commit | cut -c1-8) deletes $DELETED files (threshold: 200)"
            exit 1
          fi
        done
```

## 边界情况与处理

### 情况 1：合法的大规模删除

**场景**: 移除包含 500 个文件的废弃功能

**解决方案**: 使用 bypass flag，并在提交消息中明确说明原因。

```bash
# Option 1: Environment variable bypass
ALLOW_MASS_DELETE=1 git commit -m "feat: remove deprecated auth v1

Removing deprecated authentication v1 system:
- 487 files deleted
- Migration guide: docs/migration/auth-v1-to-v2.md
- Reason: No users on v1 for 6 months

ALLOW_MASS_DELETE: Intentional mass deletion"

# Option 2: Split into logical commits
git commit -m "feat: remove deprecated auth v1 - step 1/3 (handlers)"
git commit -m "feat: remove deprecated auth v1 - step 2/3 (models)"
git commit -m "feat: remove deprecated auth v1 - step 3/3 (tests)"
```

### 情况 2：目录重命名（Git 看到的是删除 + 新增）

**场景**: 将 `src/old-structure/` 移动到 `src/new-structure/`

**检测**: Git 会识别 rename，而不是纯删除。

```bash
# Git is smart about renames
git mv src/old-structure src/new-structure
git commit -m "refactor: reorganize directory structure"

# This shows as renames (R), not deletions (D)
git show --name-status
# R100  src/old-structure/file.ts -> src/new-structure/file.ts
```

**影响**: 不会触发删除检查，因为检查使用 `--diff-filter=D`。

### 情况 3：清理生成文件

**场景**: 移除 `node_modules` 或构建产物

**预防**: 这些文件应该在 `.gitignore` 中，永远不应该被提交。

```bash
# If accidentally committed
git rm -r --cached node_modules
git commit -m "fix: remove accidentally committed node_modules"

# Will trigger if 200+ files, which is correct
# Because this was a mistake that needs attention
```

## 配置

### 阈值

**文件**: `scripts/safety-config.json`（未来增强）

```json
{
  "deletion": {
    "threshold": 200,
    "bypassVar": "ALLOW_MASS_DELETE",
    "requireJustification": true
  }
}
```

### Bypass 机制

1. **环境变量**: `ALLOW_MASS_DELETE=1`
2. **提交消息**: 包含 `ALLOW_MASS_DELETE: reason`
3. **紧急情况**: `SKIP_HOOKS=1`（绕过所有检查）

### 豁免

不计入阈值的文件/目录：

- 生成文件（如果在 `.gitignore` 中但已被跟踪）
- 锁文件更新（单个文件，很多行）
- 自动生成的文档

**实现**: 初期不需要；如果出现误报，可以再添加。

## 测试策略

### 单元测试：Pre-Commit Hook

```bash
# Create test repo with 250 deleted files
cd /tmp
mkdir test-deletion-limit
cd test-deletion-limit
git init

# Create 250 files
for i in {1..250}; do echo "file $i" > "file$i.txt"; done
git add .
git commit -m "initial"

# Delete them all
git rm file*.txt

# Try to commit (should be blocked)
cp /path/to/routa/.husky/pre-commit .git/hooks/
git commit -m "delete files"
# Expected: ❌ COMMIT BLOCKED
```

### 集成测试：CI/CD

创建一个包含大规模删除的 PR，验证 CI 会阻止它。

## 指标

持续跟踪：

- **触发阻止次数**: 被阻止提交的数量
- **使用 bypass 次数**: `ALLOW_MASS_DELETE` 的使用次数
- **误报**: 被阻止的合法操作
- **漏报**: 通过检查的大规模删除

**目标**: 每月误报少于 1 次

## 相关机制

- Git Commit Safety（测试凭据）
- File Budget Limits（每次提交的变更规模）
- Branch Protection Rules

## 实现清单

- [x] 设计文档
- [ ] 更新 `.husky/pre-commit`
- [ ] 更新 `.husky/pre-push`
- [ ] 更新 `.github/workflows/defense.yaml`
- [ ] 添加测试
- [ ] 更新文档

## 参考

- 先前事故: docs/issues/2026-04-06-test-git-credentials-leak.md
- Git 安全设计: docs/design-docs/git-commit-safety-mechanism.md
