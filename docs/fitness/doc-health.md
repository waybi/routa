---
dimension: doc_health
weight: 0
tier: fast
threshold:
  pass: 100
  warn: 80

metrics:
  - name: check_doc_health
    command: node --import tsx scripts/docs/check-doc-health.ts 2>&1
    pattern: "doc_health_ok"
    hard_gate: false
    tier: fast
    execution_scope: ci
    gate: advisory
    kind: holistic
    analysis: static
    evidence_type: command
    scope: [docs]
    run_when_changed:
      - docs/**
      - resources/specialists/**
      - AGENTS.md
      - scripts/docs/**
    description: "documentation-map 与 Agent/Specialist 清单同步检查：specialist docs 新鲜度、ADR 索引同步、AGENTS.md 仓库地图路径可达、关键文档交叉引用完整"
---

# Documentation Health 证据

> 本文件记录文档健康检查，确保 documentation-map、Agent/Specialist 清单、ADR 索引、和关键文档交叉引用保持同步。
>
> **核心理念**: 文档漂移是代理驱动开发中最常见的技术债之一。自动化检查让漂移在变更时被发现，而不是在下一次新人入职或 agent 查阅时才暴露。

## 检测矩阵

| 检测项 | 说明 | Hard Gate | 工具 |
|--------|------|-----------|------|
| specialist_docs_freshness | `docs/specialists/` 生成内容与 `resources/specialists/**/*.yaml` 源保持数量一致 | ❌ | `check-doc-health.ts` |
| architecture_adr_sync | 所有 ADR 文件都被 `docs/adr/README.md` 和 `docs/ARCHITECTURE.md` 引用 | ❌ | `check-doc-health.ts` |
| agents_md_repo_map | `AGENTS.md` Repository Map 中引用的路径全部可达 | ❌ | `check-doc-health.ts` |
| doc_cross_refs | 关键文档（ARCHITECTURE.md, adr/README.md, fitness/README.md, references/README.md）的内部链接目标存在 | ❌ | `check-doc-health.ts` |

## 为什么是独立维度

文档健康属于工程治理的子集，但有足够的独立性值得单独跟踪：

- **Specialist 清单漂移**是最高频问题：新增/删除 specialist YAML 后忘记重新生成文档。
- **ADR 索引漂移**在 agent 频繁创建决策记录时尤其容易发生。
- **Repository Map 路径断裂**在重构移动文件后很难手动发现。
- 这些问题都不是代码质量问题，也不是测试问题，放进 `code_quality` 或 `engineering_governance` 会模糊维度边界。

当前权重设为 `0`——不影响总分，但会出现在 entrix 报告中。随着文档在 agent 工作流中的重要性提升，可以调高权重。

## 本地执行

```bash
# 直接运行检查
node --import tsx scripts/docs/check-doc-health.ts

# 如果 specialist docs 不新鲜，先重新生成
npm run docs:specialists:generate

# 通过 entrix 运行
entrix run --dimension doc_health
```

## 修复指南

| 失败项 | 修复方法 |
|--------|---------|
| specialist_docs_freshness | `npm run docs:specialists:generate` |
| architecture_adr_sync | 在 `docs/adr/README.md` 和 `docs/ARCHITECTURE.md` 的 ADR 表格中补上缺失的 ADR |
| agents_md_repo_map | 更新 `AGENTS.md` 的 Repository Map 中失效的路径引用 |
| doc_cross_refs | 修复关键文档中的断裂链接（通常是重命名/移动后忘改引用） |

## 相关文件

| 文件 | 用途 |
|------|------|
| `scripts/docs/check-doc-health.ts` | 检查脚本实现 |
| `scripts/docs/generate-specialist-docs.ts` | Specialist 文档生成器 |
| `docs/specialists/` | 自动生成的 Specialist 文档（.gitignore 管理） |
| `docs/ARCHITECTURE.md` | 架构文档（含 ADR 表格） |
| `docs/adr/README.md` | ADR 索引 |
| `AGENTS.md` | 仓库操作契约（含 Repository Map） |
| `docs/fitness/engineering-governance.md` | 工程治理维度（文档健康的近邻） |
