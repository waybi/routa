# Koda 融合产品 — 会话交接上下文

> **用途**：让后续 agent / 协作者无缝接手，不需要重读整段对话。  
> **日期**：2026-07-21（v0.3 同步修订）  
> **会话性质**：产品方向澄清 + 产品形态设计（未进入实现）  
> **当前仓库**：`/Users/waybi/Desktop/my/routa`（学习/参考仓，分支 `arch-classics`）  
> **状态**：产品形态 **v0.3 已写**（待用户确认冻结）；v0.2 的 P0 + 主要 P1 已修完

---

## 0. 30 秒结论

用户要做一个**全新代码库、全栈自研**的本地产品（暂名 **Koda**）：

- **形态**：看板驱动的本地 AI 开发工厂——人定需求、做验收；AI 并行开发与审查。
- **设计来源**：Routa 出协调平面设计；cc-haha 出执行引擎 + 工作台 UX 设计。  
  **两边都不搬代码，只吸收设计。**
- **执行引擎不外包 SDK**——要自研 agent loop（设计蓝本 = cc-haha）。
- **当前交付物**：`docs/product-specs/2026-07-21-koda-product-form-design.md`（**v0.3，待用户确认冻结**）。
- **下一步**：用户确认冻结 v0.3（可对照 `prototypes/koda-v03` 原型）→ 开 cc-haha 拆解战役 E0–E8 → 架构/行动契约 → 编码。

---

## 1. 前因：为什么会有这个产品

### 1.1 两条上游线

| 项目 | 路径 | 角色 | 已有资产 |
|---|---|---|---|
| **Routa** | `/Users/waybi/Desktop/my/routa` | 多 agent 协调平台（Next.js + Rust 双后端） | 学习拆解完成：`docs/learning/koda-replication/` Phase 0–7 + `BUILD_ORDER.md` |
| **cc-haha** | `/Users/waybi/Desktop/my/cc-haha` | Claude Code 桌面工作台（Bun + Electron） | 官方/仓库内 agent、memory、skills 实现文档；本会话只做了 GUI 调研，**未做复刻级拆解** |
| **Koda** | `/Users/waybi/Desktop/my/koda` | 曾是 Routa 复刻练习仓 | 有 Phase 0 骨架 + 旧 `BUILD_ORDER.md`；产品身份可能升格为新产品本体，但**产品文档现落在 routa 仓** |

### 1.2 互补判断（会话早期结论）

- Routa：**协调平面**强（Kanban、Store、Worker、Workflow DAG、Provider 防腐层），无自有 agent 运行时。
- cc-haha：**执行平面**强（agent loop、工具、权限、记忆、Skills、桌面 UX），协调弱（Teams 文件邮箱轮询，无耐久任务图）。
- 合在一起 = 看板驱动的本地 AI 开发团队。

### 1.3 方向演变（重要：勿沿用被否方案）

| 时间序 | 方案 | 结果 |
|---|---|---|
| 初版 | fork cc-haha 当底盘，Routa 当器官捐献者 | **已废弃**（用户要可控） |
| 中间版 | 全新代码库，但执行引擎外包 Claude Agent SDK | **已废弃**（用户明确要自研 loop） |
| **定案** | **全新代码库 + 全栈自研**：协调自研（蓝本 Routa）+ 执行引擎自研（蓝本 cc-haha） | **当前有效** |

用户原话要点：

- 发布意图：**纯自用 / 开源，不商业化**。
- 「更偏向全新代码库，这样所有东西才更可控」。
- 「拆解 cc-haha 就是为了做执行循环；未来的执行引擎 SDK 也是我们自己写的，直白来说就是 copy cc-haha 这套设计」。
- 「cc-haha 拆解放下一阶段，当前先当产品经理把产品形态设计出来」。

---

## 2. 已拍板的产品决策

### 2.1 Brainstorming 早期决策（仍有效）

| ID | 决策 | 选项 |
|---|---|---|
| Q1 | 核心场景 | **A 并行开发工厂**；看板是主界面，会话是卡片附属 |
| Q2 | 人在环边界 | **A 列级门禁 / 验收制**；列内宽权限 + worktree 隔离，人最大脱离 |
| Q3 | Review 谁把关 | **B AI 审查员先过**；人只做最终验收；打回循环不惊动人 |
| Q4 | 需求进料 | **C planner 拆卡为主 + 手写快速建卡** |
| Q5 | 项目模型 | **C v1 一看板一仓库**；模型预留多仓库字段 |
| Q6 | v1 触达 | **v0.3 裁定：仅桌面通知**（原 brainstorm 记 B「核心 + IM」，与第八章冲突；**以 v0.3 为准**） |

### 2.2 v0.3 锁定的 5 个产品决策（用户拍板，已写入主文档）

| # | 决策 | 裁定 | 文档位置 |
|---|---|---|---|
| 1 | 手动拖卡 | **仅 Backlog 列内排序**；禁止跨列拖动 | §3.3 |
| 2 | 验收后交付 | 项目级 `deliveryMode` 三档，**默认 `auto-merge` squash**；另有 `pr` / `branch` | §3.5 |
| 3 | v1 触达 | **仅桌面通知**；IM/H5 预留接口，v1.x 再补 | 第八章 |
| 4 | 并发槽位 / priority | **全局槽位池（默认 2）**；出队序 = priority → manualOrder → createdAt；priority **不抢占** | §3.4 |
| 5 | rebase/merge 执行者 | **系统内置任务**（确定性 git，非 specialist，不占槽、不产生会话页） | §3.2 / §3.5 |

### 2.3 外壳（已写入 v0.3，未再单独争议）

- Sidebar：收件箱 + 项目列表 + 设置  
- TabBar：Board（默认）/ 验收台 / 接管会话 / 设置  
- Board 顶部进料口 + 底部状态栏  
- 卡片详情：**5 tab**（概览 / 验收标准 / 活动流 / 变更 / 历史）

---

## 3. 产品形态文档现状

### 3.1 主文档

**路径**：`docs/product-specs/2026-07-21-koda-product-form-design.md`  
**版本**：**v0.3**  
**状态**：**待用户确认冻结**  
**结构**：九章（定位 / 场景 / 对象模型+状态机 / 信息架构 / 交互流 / 线框 / 异常 / 非目标 / 北极星）+ 上游对应表 + 修订记录  

**曾短暂写到** `~/Desktop/my/koda/docs/product/`，用户要求**移到当前 routa 项目**；Koda 侧副本已删。

### 3.2 v0.2 → v0.3 已完成的修复

**P0（原阻塞定稿，现已修）：**

1. ✅ 状态机闭环：DRAFT 不上看板；READY = 已占槽待派发；FIXING/MERGING/CANCELLED 列归属与副作用补齐；新增**状态 × 列 × 触发者 × 副作用总表**；FAILED/HELP/PAUSED/TAKEN_OVER 改为**叠加标记**（不换列）
2. ✅ 「拖动即指令」删除；改为列流转状态机驱动 + Backlog 内排序
3. ✅ Q6 触达：裁定仅桌面通知，第八章注明
4. ✅ 附录 / 详情 6-tab → **5-tab**

**P1（主要项已修）：**

- ✅ `deliveryMode` 三档  
- ✅ 依赖 / 全局槽位 / priority 出队语义  
- ✅ rebase = 系统任务  
- ✅ 验收标准质量门槛（至少 1 条可机器验证；reviewer 可标「需人工判断」）  
- ✅ HELP / 接管 / 交还 + `TAKEN_OVER` 调度语义  
- ✅ 8 视图补齐线框（§6.5–6.8：接管会话 / 收件箱 / 团队配置 / 设置）  
- ✅ 北极星五项进设置 → 统计分区（无独立报表页）

### 3.3 v0.3 关键建模摘要（接手必懂）

- **Card / Run 双生命周期**：卡 = 业务进度；Run = 单轮执行（plan/develop/review/fix）。
- **Worktree 挂在 Card 上**（打回重修保留改动）。
- **state vs overlayFlags 分离**：列由 `state` 决定；异常/介入是叠加标记。
- **人的动作全集有限**：进料、Backlog 排序、验收 a/r、轻回复、接管/交还、重试、加预算、解依赖/取消——其余自动。
- **人只被四类 Inbox 打断**：待验收 / 求助 / 失败 / 成本超限。

---

## 4. 全栈自研后的拆解与施工路线（尚未执行）

```text
① 产品形态 v0.3 用户确认冻结   ← 当前卡点（文档已写，等确认）
② cc-haha 复刻级拆解 E0–E8     ← 用户曾明确「下一阶段」
③ 架构设计 + 技术规格 + 行动契约（建议落 Koda 或未来新产品仓）
④ agent 编码：协调平面 + 执行引擎 + 工作台
```

### 4.1 cc-haha 拆解战役（定案，未开工）

复刻级、按依赖拓扑，文档拟住 **cc-haha 仓库本地**，入库前多 agent 核查：

| 相 | 内容 |
|---|---|
| E0 | 类型底座：消息/事件、Tool 接口 |
| E1 | 查询循环（心脏）：QueryEngine / query |
| E2 | 工具系统 + 三层工具池 |
| E3 | 权限系统 + 审批协议 |
| E4 | 上下文：systemPrompt / compact / token |
| E5 | 会话持久化 / transcript / resume |
| E6 | 多 agent：四路径、fork 缓存、LocalAgentTask、worktree |
| E7 | 记忆 + Skills（核验式；官方 docs 已细） |
| E8 | server/WS + 桌面 AppShell/Workbench UX |
| 不拆 | IM adapter 细节、voice/vim/ssh、Ink TUI 渲染细节 |

### 4.2 Routa 侧已可直接当输入

- `docs/learning/koda-replication/BUILD_ORDER.md`  
- `phase0-analysis.md` … `phase7-analysis.md`  
- 复盘确认的三大债务（施工时要修，不照抄）：  
  1. 协调状态耐久化  
  2. Workflow fan-in / 父 Run 终态收敛  
  3. 多写入口政策一致性（CAS/状态迁移）

### 4.3 GUI 调研摘要（本会话已做）

**Routa UI（设计稿级）**：看板 dnd + liveMessageTail + 卡片详情多 tab + 列自动化编辑 + 底部状态栏；Next.js，**不搬代码**。  

**cc-haha UI（设计稿级）**：AppShell（Sidebar+TabBar）、会话工作台、右侧 Workbench/DiffViewer、PermissionDialog、设置枢纽；**不搬代码**，自研时对照。

---

## 5. 未决事项 / 坑（接手必看）

1. **产品形态待冻结确认**：v0.3 文档已就绪；需用户一句话「冻结」或继续改。冻结前不要当施工规格硬编码。  
2. **~~Q6 触达范围冲突~~**：已在 v0.3 裁定为仅桌面通知。  
3. **文档落点策略**：产品文档现放在 **routa** `docs/product-specs/`（用户要求「移到当前项目」）。后续是：  
   - 继续以 routa 为产品文档暂存仓，或  
   - 定稿后迁回 Koda/新仓  
   需用户一句话定夺（不阻塞 v0.3 冻结）。  
4. **auto memory `fusion-product.md`**：若仍写「执行外包 SDK」或 v0.2 未决态，接手时按本文 + 主文档对齐修正。  
5. **Routa 仓纪律**：纯学习/解读向；不改 Rust 业务、不跑 entrix/fitness；用户未要求则不 commit。  
6. **legal**：自研全新代码库 + 不 fork 泄露源码 → 开源血统干净；仍勿在宣传上碰 “Claude Code” 商标。  
7. **暂用名 Koda**：产品名未最终 branding 确认。

---

## 5.1 产品原型（2026-07-21 新增）

- **路径**：`/Users/waybi/Desktop/my/routa-wt-koda-prototype/prototypes/koda-v03/`
- **分支 / worktree**：`codex/koda-product-prototype` @ `routa-wt-koda-prototype`
- **启动**：`python3 -m http.server 5177` → http://127.0.0.1:5177
- **性质**：可点击 HTML 原型，对齐 v0.3 信息架构与主流程；非生产代码。

## 6. 相关文件索引

| 文件 | 说明 |
|---|---|
| `docs/product-specs/2026-07-21-koda-product-form-design.md` | **产品形态 v0.3 主文档（待冻结）** |
| `docs/product-specs/2026-07-21-koda-session-handoff.md` | **本文：会话交接** |
| `docs/learning/koda-replication/BUILD_ORDER.md` | Routa→Koda 施工拓扑 |
| `docs/learning/koda-replication/phase0~7-analysis.md` | Routa 分层解剖 |
| `docs/learning/README.md` | 学习文档分类法 |
| `~/Desktop/my/cc-haha/` | 执行引擎设计源（待 E0–E8） |
| `~/Desktop/my/koda/` | 可能的产品本体仓（现多为旧骨架） |
| Claude auto-memory `fusion-product.md` | 跨会话项目记忆（需与本文一致） |

---

## 7. 给下一个 agent 的操作协议

### 若任务是「冻结 / 微调产品文档」

1. 读 `2026-07-21-koda-product-form-design.md`（v0.3）+ 本文 §2 / §3 / §5。  
2. 用户若只说「冻结」：把主文档状态从「待用户确认冻结」改为「**已冻结**」，补修订记录一行，同步本文 §0/§3/§5。  
3. 用户若继续改：小改保持 v0.3 + 修订记录；语义级变更升 v0.4。  
4. **改 docs 前**若涉及 `docs/learning/` 需确认；`product-specs/` 用户已授权写入。

### 若任务是「开 cc-haha 拆解」

1. 优先确认产品形态已冻结或用户明确允许并行。  
2. 在 **cc-haha 仓** 建 `docs/learning/` 类目录，按 E0→E8 写 phase-analysis。  
3. 方法论对齐 Routa：业务痛点 → 堵法 → file:line → 可迁移模式；多 agent 核查。  
4. 拆解目标是 **自研执行引擎的设计输入**，不是 fork 代码。

### 若任务是「架构 / 行动契约 / 编码」

1. 输入必须是：**冻结后的产品形态** + Routa koda-replication +（进行中的）cc-haha E 相拆解。  
2. 用用户的行动契约方法论（Design Doc + ADR + Spec by Example）。  
3. 施工时主动修 Routa 三大债务，禁止「教学边界」原样拷贝进产品。  
4. 全新仓落点：优先问用户是扩 `~/Desktop/my/koda` 还是新开 repo。

### 明确不要做的事

- 不要再提 fork cc-haha 或执行引擎外包官方 SDK 作为默认方案。  
- 不要在未确认时 `cargo build -p entrix` / 跑 fitness。  
- 不要把 cc-haha / Routa 源码拷进新产品仓当实现。  
- 不要在用户未要求时 commit / push / 写 vault。  
- 不要把已否决的「拖动即指令 / IM 进 v1 / 执行外包 SDK」写回文档。

---

## 8. 一句话留给后人

> **Koda = 用 Routa 的协调设计 + cc-haha 的执行引擎设计，在全新代码库里自研的本地看板工厂；人只验收。产品形态 v0.3 已修完 v0.2 全部 P0 与主要 P1（5 决策已锁），状态为待用户确认冻结；下一步是冻结后拆 cc-haha、再写架构与契约。**
