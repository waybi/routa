---
title: "提交校验前测试 Git 凭据泄漏到生产提交"
date: "2026-04-06"
status: resolved
severity: medium
area: "git"
tags: ["git", "credentials", "commit", "safety", "cleanup"]
reported_by: "agent"
related_issues: []
resolved_at: "2026-04-28"
resolution: "已实现预防机制；文档化的清理建议是避免重写已推送的旧历史。"
---

# 测试 Git 凭据泄漏到生产提交

**日期**: 2026-04-06  
**严重级别**: Medium  
**状态**: 已修复（预防），清理待定

## 问题

测试 Git 凭据（`Routa Test <test@example.com>`）出现在真实分支上的生产提交中，包括已经推送到仓库的提交。

### 根因

`workspace-tools.ts` 中的 `git_commit` 工具在创建提交前没有校验 Git 用户配置。当 AI Agent 使用这个工具时：

1. 如果 Agent 在带有测试 Git 配置的目录中运行（例如没有正确清理的测试仓库）
2. 或者测试配置以某种方式泄漏到了用户仓库
3. 提交就会使用该目录中设置的任意 `user.name` 和 `user.email` 创建

结果是多个分支上至少出现了 **12 个带有测试凭据的生产提交**。

## 受影响提交

```
d72a6631 - docs: add project summary and demo report (feat/evolution-pattern-extraction)
dd1c71de - update (origin/issue-283-implementation-plan)
10fce88f - initial
b615af8a - fix(kanban): recover session metadata and collapse task prompts
ac71f2db - feat(kanban): compact session run status with icons
c7561e65 - fix(acp): persist selected provider across pages
86038855 - fix(kanban): preserve provider on github imports
0bf08b86 - fix(chat): keep send visible for opencode composer
02e8b0ed - fix(kanban): preserve customized review automation
71a46319 - fix(db): ensure default sqlite workspace exists
abaf8c09 - update (pr-289)
3a5e3612 - initial
```

## 已应用修复

### 1. Git 提交校验（commit: a75a2901）

在 `src/core/tools/workspace-tools.ts` 的 `gitCommit()` 函数中增加校验：

- ✅ 提交前检查 Git `user.name` 和 `user.email`
- ✅ 阻止带有测试/占位凭据的提交：
  - `test@example.com`
  - `Routa Test`
  - `Test`
  - `placeholder`
- ✅ 返回清晰错误信息，并提示配置 Git identity
- ✅ 在成功结果中包含 author 信息，便于审计

### 2. 测试仓库作用域（commit: a75a2901）

更新所有测试文件，在设置 Git 配置时使用 `--local` flag：

- `crates/routa-core/src/trace/vcs.rs`
- `crates/routa-server/tests/rust_api_end_to_end.rs`
- `crates/routa-core/src/git.rs`
- `src/core/review/__tests__/review-analysis.test.ts`

这确保测试凭据只作用于临时测试仓库，不能泄漏到其他仓库。

### 3. RAII 测试清理（commit: 6fb9add0）

使用 Rust 的 RAII 模式改进测试仓库清理：

- ✅ 使用 `TempDir` 代替手动 `fs::remove_dir_all`
- ✅ 即使测试 panic 或提前 return，也会自动清理
- ✅ 防止失败测试污染 `/tmp` 目录

**之前**: 只有测试成功完成时才手动清理

```rust
let repo_path = random_repo_path();
// ... test code ...
let _ = fs::remove_dir_all(&repo_path); // May not run if test panics
```

**之后**: 通过 RAII 自动清理

```rust
let (_temp_dir, repo_path) = create_temp_repo();
// ... test code ...
// _temp_dir automatically cleaned when it goes out of scope
```

## 清理选项

### 选项 1：保持现状（推荐）

- 这些提交位于 feature branches 和旧 PR 上
- 大多数不在 main 分支历史中
- 重写 Git 历史风险较高，并会影响协作者
- author metadata 属于外观问题，不影响功能

### 选项 2：重写历史（高风险）

如果确实必须清理 author 信息：

```bash
# WARNING: Only for commits not yet pushed to main
git filter-branch --env-filter '
if [ "$GIT_AUTHOR_EMAIL" = "test@example.com" ]; then
    export GIT_AUTHOR_NAME="Your Name"
    export GIT_AUTHOR_EMAIL="your.email@example.com"
    export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
    export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
fi
' --tag-name-filter cat -- --branches --tags
```

**不要重写 main 分支历史**，这会给所有贡献者带来问题。

### 选项 3：修正近期提交

对于尚未推送的近期提交：

```bash
git commit --amend --author="Your Name <your.email@example.com>" --no-edit
```

## 预防

后续通过以下措施预防该问题：

1. ✅ 每次提交前校验 Git identity
2. ✅ 阻止测试凭据
3. ✅ 提供清晰错误信息
4. ✅ 所有测试仓库使用 `--local` 配置作用域
5. ✅ 基于 RAII 自动清理测试仓库

## 建议

**接受这个外观问题**：这些提交是有效代码变更，只是 author metadata 错误。重点应放在防止未来再次发生（已经实现）。

如果这些提交位于需要合并到 main 的 PR 分支中，可以考虑：

- Squash merge（GitHub 默认）会使用合并者的凭据
- 或者在合并前按绝对必要性 amend

## 相关文件

- `src/core/tools/workspace-tools.ts` - 带校验的 Git commit tool
- Rust 和 TypeScript 中使用 Git config 的测试文件
- `.git/config` - 用户实际 Git 配置（已验证正确）

## Issue 卫生

- 2026-04-28：作为 active incident 标记为 resolved，因为 commit validation 和 test-repo scoping 已实现；剩余历史 author metadata 有意不重写。

## 验证

运行以下步骤确认无法再创建新的测试凭据提交：

```bash
# This should fail with a clear error message
cd /tmp
mkdir test-repo && cd test-repo
git init
git config --local user.name "Routa Test"
git config --local user.email "test@example.com"
echo "test" > test.txt
git add test.txt

# Try using the git_commit tool through MCP/ACP
# It should reject the commit with a validation error
```
