# Fitness Function 全景指南

> 本文是 `docs/fitness/` 目录的**人类友好全景解读**，帮助新成员快速理解 Routa 的质量门禁体系。
> 技术规范和可执行规则请参见 [README.md](./README.md)。

---

## 一句话概括

`docs/fitness/` 是 Routa 把"代码质量要求"从口头约定变成**机器可执行、可评分、可演进**的规则库，由 `entrix` CLI 消费，覆盖从 lint 到安全扫描到 E2E 回归的完整质量闭环。

---

## 为什么需要这个目录

Routa 是一个 AI Agent 协作平台，日常开发中有大量 AI 生成的代码参与。传统的 "reviewer 凭经验把关" 模式在 AI 高频产出下不够可靠，所以项目采用 **Defense-in-Depth**（深度防御）策略：

- **控制爆炸半径**：通过权限和行为约束限定 AI 的操作范围
- **反熵增机制**：设立质量门槛与技术债检查，将 AI 的解空间限制在安全边界内
- **契约优先**：`api-contract.yaml` 作为单一事实来源，双后端（Next.js + Rust/Axum）必须一致

灵感来自《Building Evolutionary Architectures》中的 **Fitness Function** 概念——用持续演进的自动化约束保护架构健康。

---

## 运行方式

这些 `.md` 文件不仅仅是文档——每个文件头部都有 **YAML frontmatter**，定义了可被机器解析的 metrics（指标）。

执行引擎是 `crates/entrix/`（Rust CLI），流程如下：

```
docs/fitness/*.md 的 frontmatter
        │
        ▼
  entrix 解析出每个维度的 metrics
        │
        ▼
  按 tier 过滤，执行每条 metric 的 shell command
        │
        ├── 检查输出是否匹配 pattern（正则）
        ├── hard_gate 失败 → 直接阻断
        └── 加权评分 → Σ(Weight × Score) / 100
              < 80 阻断 | 80-90 强告警 | ≥ 90 通过
```

### 常用命令

```bash
# 快速检查（仅 fast tier，<30s）
entrix run --tier fast

# 标准检查（fast + normal tier，<5min）
entrix run --tier normal

# 完整检查（所有 tier，<15min）
entrix run

# 仅查看会执行什么（不实际运行）
entrix run --dry-run

# 并行加速
entrix run --parallel

# 仅运行指定维度
entrix run --tier normal --dimension code_quality --dimension testability
```

---

## 十个质量维度

整个评分体系由 **10 个维度**构成，权重合计 100%：

### 有权重维度（影响总分）

| 维度 | 权重 | 证据文件 | 检查什么 |
|------|------|----------|----------|
| **testability** | 20% | [unit-test.md](./unit-test.md) | TS/Rust 测试通过率、覆盖率 ≥80%、代码图测试映射 |
| **security** | 20% | [security.md](./security.md) | npm audit / cargo audit / Semgrep SAST / Trivy / Hadolint |
| **code_quality** | 18% | [code-quality.md](./code-quality.md) | 文件行数预算、函数行数、重复代码、lint / typecheck / clippy |
| **api_contract** | 10% | [rust-api-test.md](./rust-api-test.md) | API 端点矩阵、正向/负向用例、契约一致性 |
| **design_system** | 10% | [design-system-quality-layers.md](./design-system-quality-layers.md) | CSS 契约、品牌语义、Storybook 治理、视觉回归、可访问性 |
| **evolvability** | 8% | [api-contract.md](./api-contract.md) | OpenAPI schema 校验、双后端一致性、breaking changes |
| **ui_consistency** | 8% | [design-system-shell.md](./design-system-shell.md) | Desktop shell token 接入、颜色契约、页面覆盖 |
| **engineering_governance** | 6% | [engineering-governance.md](./engineering-governance.md) | scripts 目录膨胀、blast radius、外链可达、TODO/FIXME 数量 |

### 零权重维度（仅记录，不影响总分）

| 维度 | 证据文件 | 记录什么 |
|------|----------|----------|
| **observability** | [runtime/observability.md](./runtime/observability.md) | instrumentation 入口、OTel trace、运行时错误可见性 |
| **performance** | [runtime/performance.md](./runtime/performance.md) | 路由 FCP / CSS 体积、启动延迟基线、SQLite WAL 模式 |

> observability 与 performance 目前是运行时维度，权重为 0，不改变总分，但作为执行证据出现在报告里。

---

## 三层 Tier 分层

每条 metric 的 frontmatter 里有 `tier` 字段标记它属于哪一层：

| Tier | 时间预算 | 包含内容 | 典型场景 |
|------|---------|---------|---------|
| **fast** | < 30s | Lint、typecheck、clippy、增量 TS 测试、契约 schema | 本地快速验证、每次保存 |
| **normal** | < 5min | fast + 全量 TS 测试、Rust 测试、API 测试、代码质量 | pre-push、PR 检查 |
| **deep** | < 15min | normal + E2E 测试、安全扫描、视觉回归 | CI 完整流水线 |

---

## Hard Gate（硬门禁）

硬门禁失败**直接阻断**，不计入评分，一票否决：

| Gate | 命令 | 含义 |
|------|------|------|
| `ts_test_pass` | `npm run test:run:fast` | 增量 TS 测试必须 100% 通过 |
| `ts_test_pass_full` | `npm run test:run` | 全量 TS 测试必须 100% 通过 |
| `rust_test_pass` | `cargo test --workspace` | Rust 测试必须 100% 通过 |
| `api_contract_parity` | `npm run api:check` | 双后端 API 必须一致 |
| `lint_pass` | `npm run lint` | 0 errors |
| `no_critical_vulnerabilities` | `snyk test` | 0 critical 漏洞 |

---

## Frontmatter 规范

证据文件使用 YAML frontmatter 定义可执行的 metrics，这是 entrix 识别和运行检查的核心格式：

```yaml
---
dimension: testability          # 维度名称
weight: 20                      # 权重百分比
tier: normal                    # 默认 tier
threshold:
  pass: 80                      # 通过阈值
  warn: 70                      # 警告阈值

metrics:
  - name: ts_test_pass          # 指标名称
    command: npm run test:run:fast 2>&1   # 执行的 shell 命令
    pattern: "Tests\\s+passed"  # 成功匹配正则（可选）
    hard_gate: true             # 是否为硬门禁
    tier: fast                  # 可覆盖维度默认 tier
---
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | 是 | 指标名称，用于显示 |
| `command` | 是 | Shell 命令，建议加 `2>&1` 捕获 stderr |
| `pattern` | 否 | 成功匹配的正则，未设置则用 exit code |
| `hard_gate` | 否 | 硬门禁失败直接阻断（默认 false）|
| `tier` | 否 | 覆盖维度默认 tier |
| `execution_scope` | 否 | `ci` / `local`，控制执行环境 |
| `gate` | 否 | `advisory` 表示仅告警不阻断 |

---

## 目录文件索引

### 核心规则

| 文件 | 说明 |
|------|------|
| [README.md](./README.md) | **总入口**——防御理念、Quick Start、维度表、评分模型、Frontmatter 规范、模块架构 |
| [manifest.yaml](./manifest.yaml) | **证据文件注册表**——列出所有被 entrix 消费的 evidence files |

### 维度证据文件

| 文件 | 维度 | 权重 | 典型检查项 |
|------|------|------|-----------|
| [code-quality.md](./code-quality.md) | code_quality | 18% | 文件/函数行数预算、jscpd 重复检测、ast-grep 结构异味、lint / typecheck / clippy / dependency-cruiser |
| [unit-test.md](./unit-test.md) | testability | 20% | TS 增量/全量测试、V8 覆盖率、Rust workspace 测试、代码图测试半径与映射探针 |
| [security.md](./security.md) | security | 20% | npm audit (critical/high)、cargo audit、Semgrep (ERROR/WARNING)、Trivy 文件系统扫描、Hadolint |
| [rust-api-test.md](./rust-api-test.md) | api_contract | 10% | API 一致性检查 + 端点矩阵（workspace / note / task / kanban / session 的 VERIFIED/TODO 状态） |
| [api-contract.md](./api-contract.md) | evolvability | 8% | OpenAPI schema 校验、双后端一致性、breaking changes 检测 |
| [design-system-quality-layers.md](./design-system-quality-layers.md) | design_system | 10% | 6 层质量门——CSS 契约、品牌语义、颜色系统 advisory、Storybook 治理、视觉回归、可访问性 |
| [design-system-shell.md](./design-system-shell.md) | ui_consistency | 8% | Desktop shell 路由回归、token 接入、颜色契约、页面覆盖 |
| [engineering-governance.md](./engineering-governance.md) | engineering_governance | 6% | scripts 根目录冻结预算、blast radius 代码图、Markdown 外链可达、TODO/FIXME 计数 |
| [backend-architecture.md](./backend-architecture.md) | architecture_quality | 0% | TS backend core 边界约束（core 不依赖 app/client）、循环依赖检测，advisory 不进 CI |
| [web-qa-e2e-matrix.md](./web-qa-e2e-matrix.md) | ui_consistency | 0% | Web 主链路 / Kanban / 设置 / 协议的 Playwright E2E 回归，deep tier advisory |
| [runtime/observability.md](./runtime/observability.md) | observability | 0% | instrumentation 入口、OTel trace smoke、运行时错误可见性契约 |
| [runtime/performance.md](./runtime/performance.md) | performance | 0% | 路由 FCP / CSS 体积 smoke、启动延迟基线、SQLite WAL 模式守卫 |

### 支撑配置

| 文件 | 说明 |
|------|------|
| [file_budgets.json](./file_budgets.json) | **代码膨胀预算**——默认每文件 ≤ 1600 行；历史热点文件有独立冻结上限，只允许缩小不允许膨胀 |
| [file_budgets.pre_commit.json](./file_budgets.pre_commit.json) | pre-commit 阶段使用的行数预算配置 |
| [review-triggers.yaml](./review-triggers.yaml) | **代码审查触发器**——改了高风险目录（`src/core/acp/**` 等）或敏感文件（`api-contract.yaml` 等）时自动触发 staged review 或人工审查 |
| [release-triggers.yaml](./release-triggers.yaml) | **发布门禁**——禁止 release 包含 sourcemap / 测试文件；CLI 二进制和 npm tarball 有体积增长上限（> 20% 需人工 review） |
| [runtime/hooks.yaml](./runtime/hooks.yaml) | **Git Hook 配置**——pre-commit 跑 fast fitness；pre-push 跑全量 TS / Rust 测试 + clippy + 测试映射探针 |
| [runtime/agent-hooks.yaml](./runtime/agent-hooks.yaml) | Agent 级别的 hook 配置 |

### Harness Fluency 模型

| 文件 | 说明 |
|------|------|
| [harness-fluency.model.yaml](./harness-fluency.model.yaml) | **成熟度模型**——5 级（Awareness → Assisted Coding → Structured AI Coding → Agent-Centric → Agent-First）× 5 维度（Task Delegation / Process Expansion / Workflow Loop / Verification & Guardrails / Context Readiness），共定义了数十个 criteria 和 detector |
| [harness-fluency.profile.agent_orchestrator.yaml](./harness-fluency.profile.agent_orchestrator.yaml) | agent_orchestrator profile 的独立评估配置 |

### 演进与 Playbook

| 文件 | 说明 |
|------|------|
| [evolution/history.jsonl](./evolution/history.jsonl) | **Harness Engineering 演进历史**——记录每次 `routa harness evolve` 的 patches 应用/失败情况、gap 分类、成功率 |
| [playbooks/](./playbooks/) | 从演进历史中自动提取的 playbook（需 3+ 成功运行才会生成） |
| [poc/fitness-v2-schema.md](./poc/fitness-v2-schema.md) | Fitness v2 schema 的 PoC 设计 |

---

## 整体数据流

```
开发者 / AI Agent 改代码
    │
    ├── pre-commit ──→ hooks.yaml ──→ fast tier metrics
    ├── pre-push   ──→ hooks.yaml ──→ full TS/Rust test + clippy
    │
    ▼
entrix run --tier <fast|normal|deep>
    │
    ├── 读取 docs/fitness/*.md 的 frontmatter
    ├── 按 tier 过滤 metrics
    ├── 执行每条 metric 的 shell command
    ├── 检查 pattern 匹配 / exit code
    ├── hard_gate 失败 → 直接阻断
    ├── 加权评分 → Σ(Weight × Score) / 100
    │     < 80 阻断 | 80-90 强告警 | ≥ 90 通过
    │
    ├── review-triggers.yaml → 高风险路径自动触发审查
    └── release-triggers.yaml → 发布时额外门禁
```

CI（GitHub Actions `defense.yaml`）会按维度扇出为独立 job，与 `docs/fitness/*.md` 的维度定义保持一一对应：

- `Gate: Code Quality`
- `Gate: Testability`
- `Gate: Security`
- `Gate: API Contract`
- `Gate: Design System`
- `Gate: Evolvability`
- `Gate: UI Consistency`
- `Gate: Engineering Governance`
- `Gate: Observability`
- `Gate: Performance`

---

## 五条核心规则

这些规则对 AI Verifier 和人工审查同等适用：

### 1. API Contract 变更规则
- 变更 HTTP 行为必须先在 `rust-api-test.md` 登记端点条目
- 每个新增/修改 endpoint 至少需要：1 个正向用例 + 1 个负向用例 + 1 个关键不变量断言
- 不允许只验证 status code；至少要有一次 body 结构或关键字段断言

### 2. 领域行为规则
- 业务/状态/错误映射变化，至少 1 个单元测试
- 边界条件至少 1 个失败用例
- 不允许只靠"快照文本"冒充行为验证

### 3. 测试数据与隔离规则
- 明确前置数据、明确清理策略
- 禁止隐式共享状态导致测试顺序相关

### 4. 证据优先规则
- 所有条目必须指向可执行的测试代码路径
- 不可执行项标记为 `blocked` 并给出原因

### 5. Gate 规则
- 所有 `critical` 条目为 `VERIFIED` 才可通过
- 负向路径缺失直接阻断

---

## 如何添加新维度

1. 在 `docs/fitness/` 下创建新 `.md` 文件，写好 frontmatter：

```yaml
---
dimension: e2e
weight: 10
threshold:
  pass: 90
  warn: 80

metrics:
  - name: playwright_e2e
    command: npx playwright test --reporter=line 2>&1
    pattern: "\\d+ passed"
    hard_gate: false
---

# E2E 测试证据

## 测试清单
- [ ] Home → Agent Selection → Requirement Input
- [ ] Workspace Detail → Session Click → Trace UI
```

2. 在 `manifest.yaml` 中注册新文件
3. 运行 `entrix validate` 校验维度权重
4. 运行 `entrix run --dry-run` 确认新维度被正确识别

---

## Harness Fluency（附加能力）

除了维度评分，Fitness 体系还包含一个独立的 **Harness Fluency 成熟度模型**，用于评估仓库对 AI Agent 的友好程度：

```bash
# 通用评估
cargo run -p routa-cli -- fitness fluency

# Agent 编排型评估
cargo run -p routa-cli -- fitness fluency --profile agent_orchestrator

# 对外基线视角
cargo run -p routa-cli -- fitness fluency --framing harnessability
```

5 个成熟度等级：

1. **Awareness** — 有基本的 AI 协作契约（如 AGENTS.md）
2. **Assisted Coding** — 有结构化的任务委派与反馈
3. **Structured AI Coding** — 有完整的工作流循环
4. **Agent-Centric** — 验证与护栏完善
5. **Agent-First** — 上下文就绪、记忆完备

---

## 相关资源

| 资源 | 说明 |
|------|------|
| [AGENTS.md](../../AGENTS.md) | 项目协作契约，指向 fitness 作为质量入口 |
| [docs/ARCHITECTURE.md](../ARCHITECTURE.md) | 架构边界与领域模型 |
| [crates/entrix/](../../crates/entrix/) | Fitness 执行引擎（Rust CLI） |
| [.github/workflows/defense.yaml](../../.github/workflows/defense.yaml) | CI 维度扇出 workflow |
| [api-contract.yaml](../../api-contract.yaml) | API 契约单一事实来源 |
