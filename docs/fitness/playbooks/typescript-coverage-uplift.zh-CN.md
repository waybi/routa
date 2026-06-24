# TypeScript 覆盖率提升 Playbook

当整体 TS 覆盖率低于目标，且希望在不引入脆弱测试的前提下快速提升覆盖率时使用本指南。

## 选择启发式

1. 导出每个文件的详细覆盖率，并按以下维度排序：
   - 语句覆盖率低
   - 语句数量大
   - 运行时表面稳定
2. 优先按以下顺序处理：
   - 具有纯异步状态转换的 hooks
   - 具有确定性 I/O 的轻量 stores / adapters
   - 子边界可 mock 的 UI 组件
   - 仅在组件 / hook 接缝处理完后再处理 pages
3. 避免过早投入以下内容：
   - ACP 进程 adapters
   - 与环境强耦合的长编排流程
   - editor / terminal / 拖拽集成，除非已部分被测试覆盖

## 测试策略

- 对于 hooks：
  - 使用 `renderHook`
  - 先覆盖挂载成功路径
  - 然后为每个异步操作覆盖一条失败路径
  - 验证合并后的派生状态，而不仅仅是单个 setter 调用
- 对于 stores：
  - 使用内存 sqlite 或小型 fake
  - 覆盖 CRUD + 过滤 + 一条 update/upsert 路径
  - 优先为每个 store 家族使用一个共享 fixture 文件
- 对于组件：
  - mock 昂贵的子组件和平台 hooks
  - 断言 prop 接线、门控（gating）和 dispatch 行为
  - 测试自动选择默认值或归一化状态的副作用（effects）

## 当前高产出模式

- 首先清理体量适中的 `0%` 或接近 `0%` 的文件。
- 然后针对 `100-250` 语句左右的文件，这类文件用一个测试文件即可覆盖大部分分支。
- 在做页面级集成测试之前，优先处理 `src/core`、`src/client/hooks` 和 `src/client/components` 下的文件。

## 工作规则

- 一个 commit = 一个覆盖率切片。
- 先运行有针对性的 Vitest。
- 每完成一个切片后运行完整的 `npm run test:cov:ts`。
- 记录哪些文件对总体覆盖率的提升最大，然后持续复用相同的文件家族。
