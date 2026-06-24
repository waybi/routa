---
title: "drizzle-kit migrate 连接 Neon serverless 时因 ECONNREFUSED 失败"
date: 2026-03-02
status: resolved
severity: high
area: infrastructure
reported_by: GitHub Issue #50
related_issues:
  - https://github.com/phodal/routa/issues/50
---

## 发生了什么

在 CI/CD 环境中运行 `npm run db:migrate`（其会执行 `drizzle-kit migrate`）时，因连接错误而失败：

```
DrizzleQueryError: Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"
at NeonPreparedQuery.queryWithCache (/home/runner/work/routa/routa/node_modules/src/pg-core/session.ts:73:11)
...
cause: ErrorEvent {
  ...
  Symbol(kError): AggregateError [ECONNREFUSED]:
    at internalConnectMultiple (node:net:1134:18)
    at afterConnectMultiple (node:net:1715:7) {
      code: 'ECONNREFUSED',
      [errors]: [Array]
    }
}
```

该错误发生在 drizzle-kit 尝试执行以下操作时：
1. 通过 WebSocket（`wss://localhost/v2`）连接 Neon serverless 数据库
2. 创建用于迁移跟踪的 `drizzle` schema
3. 应用待执行的迁移

连接尝试以 `ECONNREFUSED` 失败，表明数据库端点无法访问。

## 为何可能发生

### 1. DATABASE_URL 指向 localhost
错误中显示了 `wss://localhost/v2`，这表明 `DATABASE_URL` 环境变量可能：
- 根本未设置（导致 drizzle-kit 使用默认值/回退值）
- 被设置为 localhost 地址，而不是真正的 Neon serverless 端点
- 格式有误或缺少必需的连接参数

### 2. Neon serverless 驱动的限制
警告信息提示：
```
Warning '@neondatabase/serverless' can only connect to remote Neon/Vercel Postgres/Supabase instances through a websocket
```

这表明：
- `@neondatabase/serverless` 驱动需要 WebSocket 连接
- 它无法连接本地 Postgres 实例
- 该驱动被用于了它本不应使用的环境（带有本地 Postgres 的 CI）

### 3. CI 环境不匹配
查看 `.github/workflows/api-schema-validation.yml`（第 105-112 行），该工作流：
- 启动了一个本地 Postgres 服务容器
- 设置 `DATABASE_URL=postgresql://routa:routa_test@localhost:5432/routa_test`
- 使用 `psql` 手动应用迁移，而非 `drizzle-kit migrate`

这表明该项目有意避免在 CI 中使用 `drizzle-kit migrate`，因为：
- Neon serverless 驱动无法配合本地 Postgres 工作
- 该迁移命令期望连接的是远程 Neon 实例
- CI 使用了不同的迁移策略（直接执行 SQL 文件）

### 4. 缺少环境变量校验
`drizzle.config.ts` 文件使用了 `process.env.DATABASE_URL!`（非空断言），这会：
- 假定 `DATABASE_URL` 始终存在
- 不校验 URL 的格式或可达性
- 不为不同环境提供回退行为

## 相关文件

- `drizzle.config.ts` — Drizzle Kit 配置，被硬编码为使用 `@neondatabase/serverless` 驱动
- `src/core/db/index.ts` — 带驱动检测的数据库连接逻辑（第 44-114 行）
- `.github/workflows/api-schema-validation.yml` — 手动应用迁移的 CI 工作流（第 105-112 行）
- `package.json` — 定义 `db:migrate` 脚本（第 19 行）
- `.env.example` — 记录了预期的 `DATABASE_URL` 格式

## 来自 GitHub Issue #50 的背景

该 issue 描述了更广泛的数据库可靠性问题：
- 缺少针对瞬时连接失败的重试逻辑
- 没有用于监控的健康检查端点
- 数据库配置错误时的错误信息不清晰
- SQLite 回退在某些场景下无法正确工作

迁移失败很可能是这些底层问题的一种症状，具体表现为：
- 缺少针对特定环境的配置（CI vs 生产 vs 本地开发）
- 没有校验 `DATABASE_URL` 是否指向兼容的数据库
- Drizzle Kit 配置未考虑多驱动设置

## 其他观察

1. 该项目同时支持 Postgres（Neon）和 SQLite，但 `drizzle.config.ts` 仅配置了 Postgres
2. CI 使用了一种变通方法（手动执行 `psql`），而非修复根本原因
3. 错误信息没有引导用户走向解决方案（例如，"DATABASE_URL must point to a Neon serverless instance"）
4. 没有关于在不同环境中运行迁移的文档

## 解决方案

该问题通过以下方式解决：
1. 更新 `drizzle.config.ts`，改用 `postgres` 驱动（通过 drizzle-orm），该驱动同时支持本地和远程连接
2. 将 CI 工作流改为使用 `npm run db:push` 而非 `npm run db:migrate`
   - `db:push` 是幂等的，可直接同步 schema
   - `db:migrate` 会执行迁移文件，且在表已存在时失败
3. 对于生产环境部署，继续使用 `db:migrate` 来应用带版本的迁移
