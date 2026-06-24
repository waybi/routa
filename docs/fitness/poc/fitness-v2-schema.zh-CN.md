# Fitness V2 Schema

Issue: #217  
Parent: #181

## 目标

在升级 runner、评分和 CI 行为之前，先定义一套向后兼容的 Fitness V2 指标 schema。

## 兼容性

- 现有的 V1 frontmatter 仍然有效。
- 缺失的 V2 字段会回退到当前行为。
- 加载器会忽略未知字段。

## V2 指标字段

```yaml
metrics:
  - name: tracing_signal_available
    command: ./scripts/obs/check-tracing-signal.sh 2>&1
    pattern: "signal_ok"
    hard_gate: false
    tier: deep
    description: "Verify tracing signal in staging"

    execution_scope: staging
    gate: soft
    kind: holistic
    analysis: dynamic
    stability: noisy
    evidence_type: probe
    scope: [web, rust]
    run_when_changed:
      - src/instrumentation.ts
      - crates/routa-server/src/telemetry/**
    timeout_seconds: 120
    owner: platform
    confidence: high
    waiver:
      reason: "legacy hotspot pending refactor"
      owner: phodal
      tracking_issue: 999
      expires_at: 2026-04-30
```

## 字段默认值

| 字段 | 默认值 |
|------|---------|
| `execution_scope` | `local` |
| `gate` | 由 `hard_gate` 推导 |
| `kind` | `atomic` |
| `analysis` | `static` |
| `stability` | `deterministic` |
| `evidence_type` | `command` |
| `scope` | `[]` |
| `run_when_changed` | `[]` |
| `timeout_seconds` | 未设置 |
| `owner` | 空字符串 |
| `confidence` | `unknown` |
| `waiver` | 未设置 |

## 结果状态

- `PASS`
- `FAIL`
- `UNKNOWN`
- `SKIPPED`
- `WAIVED`

第 1 阶段仅在代码中引入状态模型。评分与治理语义将在后续阶段升级。
