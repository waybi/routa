# 学习与解剖文档的分类法（三层各有家）

| 文档类型 | 住哪 | 判断标准 |
|---|---|---|
| **模式学习笔记**（镜头/心法/跨书互证） | 知识库 Vault | 讲"可迁移模式",脱离本仓库也成立 |
| **复刻解剖文档**（koda 复刻工程的施工前分析） | 本目录 `koda-replication/` | 靠 file:line 贴着本仓库源码吃饭,离开源码无法核查 |
| **施工文档**（行为规约/施工序列） | koda 仓库（`~/Desktop/my/koda`） | 施工 agent 要在目标仓库内读 |

## Vault 指针（模式学习笔记的 canonical）

- 仓库：`~/Desktop/my/knowledge-system` → `git@github.com:waybi/Vault.git`
- 解读：`Vault/20-notes/Routa 架构拆解.md`
- 进度 / 速查：`Vault/30-maps/软件工程核心模式总表.md`
- 理论出处：`Vault/30-maps/软件架构与工程纪律地图.md`
- 学习方法：`Vault/90-system/架构学习方法.md`

## koda-replication/（复刻解剖文档）

按 koda 施工相位组织,解剖 Routa 各层设计。行为语义的 canonical 是 koda 的 `docs/contracts/` 规约,此处解剖文档仅作教学与导引。

- `koda-replication/phase0-analysis.md` — Phase 0（类型底座 + EventBus）设计解剖

## 给在本仓库工作的 agent / 协作者

- **模式学习笔记不要建在本仓库**——会和 Vault 双头漂移（已发生过一次）。
- 复刻解剖文档放 `koda-replication/`,入库前须过"多 agent 逐条核查 file:line"工序并在头部标注 `verified:`。
- 行为断言与 koda `docs/contracts/` 规约冲突时,**以规约为准**（规约有测试执法,散文没有）。
