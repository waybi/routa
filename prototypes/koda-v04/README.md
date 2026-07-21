# Koda 活原型 v0.4

基于 `docs/product-specs/2026-07-21-koda-product-form-design.md`（v0.3）的**活体交互原型**。

与 v0.3 原型的区别：这一版是「活」的——模拟引擎按 v0.3 状态机驱动卡片自动流转（QUEUED → RUNNING → REVIEWING → 打回自修复 → 待验收 → 合并），看板不碰也在跑。

## 启动

```bash
cd prototypes/koda-v04
python3 -m http.server 5178
# 打开 http://127.0.0.1:5178
```

零依赖、零构建。纯静态 HTML/CSS/ES Modules。

## 看什么

1. **首屏看板**：卡片自己在动——Dev 列 ⚡ 实时动作摘要滚动、Review 列 checklist 逐项打勾、成本数字往上跳、状态栏槽位灯闪烁。
2. **▶ 60 秒演示**（进料口右侧）：打字机进料 → Planner 流式拆卡 → 全部入场 → 5x 快进到待验收 → 提示你去验收。
3. **验收台键盘流**：点「进入验收台」后 `j/k` 切卡、`a` 通过（合并动画 → Done）、`r` 打回（评语注入新 Run）、`t` 接管。
4. **异常路径**：
   - 收件箱（侧栏 🔔）：四类打扰——待验收 / 求助 / 失败 / 成本超限，跨项目聚合
   - 点 i18n 求助卡 → 活动流里一句话轻回复，agent 继续
   - FAILED 卡（引导页动画）：重试 / 取消
   - PAUSED 卡（批量导出）：超预算护栏
5. **拖拽规则**：Backlog 内可排序；往别的列拖会被拒绝——「列流转由状态机驱动」。
6. **接管会话**：`t` 打开，左聊天右 Workbench 实时 diff，「交还」回自动流。
7. **设置**：并发槽位 / watchdog / deliveryMode / 团队配置 / 北极星五项统计。

## 覆盖的 v0.3 视图（8/8）

| # | 视图 | 入口 |
|---|---|---|
| 1 | 看板 Board | 默认标签页 |
| 2 | 卡片详情（5 tab） | 点任意卡片 |
| 3 | 验收台 | 待验收列「进入验收台」/ 收件箱 / 标签页 |
| 4 | 拆卡确认 | 进料口 ↵ |
| 5 | 接管会话 | 卡片「接管 t」/ 求助条目 |
| 6 | 收件箱 | 侧栏 🔔 |
| 7 | 团队配置 | 设置 → 团队 |
| 8 | 设置 | 侧栏 ⚙ |

## 设计旋钮

App workspace：variance 3 / motion 3 / density 7。
字体：Space Grotesk + JetBrains Mono（CJK 落 PingFang SC）。
模拟 tick 1.6s；演示模式 5x。尊重 `prefers-reduced-motion`。

> 原型中所有代码变更、审查报告、统计数据均为演示数据。
