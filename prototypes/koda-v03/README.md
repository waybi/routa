# Koda 产品原型 v0.3

基于 `docs/product-specs/2026-07-21-koda-product-form-design.md` 的可交互桌面工作台原型。

**Worktree**：`/Users/waybi/Desktop/my/routa-wt-koda-prototype`  
**分支**：`codex/koda-product-prototype`

## 启动

```bash
cd /Users/waybi/Desktop/my/routa-wt-koda-prototype/prototypes/koda-v03
python3 -m http.server 5177
# 浏览器打开 http://127.0.0.1:5177
```

当前若已有服务在跑，直接打开：http://127.0.0.1:5177

## 已覆盖视图（对齐 v0.3）

- 侧栏：收件箱、项目列表、设置
- 看板 Board：5 列 + 进料口 + Backlog 内排序（禁跨列）
- 卡片详情 Drawer：5 tab
- 验收台：队列 / diff / checklist + `j/k/a/r/t`
- 接管会话标签页 + 交还
- 收件箱弹出面板
- 拆卡确认面板（进料回车）
- 设置：通用槽位 / 项目 deliveryMode / 团队 / 北极星统计

## 建议点一点

1. 看板点「进入验收台」→ `a` 通过 / `r` 打回  
2. 收件箱点求助卡 → 轻回复  
3. 卡片「接管 t」→ 会话页 → 交还  
4. 进料口回车 → 拆卡预览 → 全部入场  
5. 设置 → 项目 → 切换 `deliveryMode`

## 预览截图（本地）

- `preview-board.png`
- `preview-accept.png`
- `preview-inbox.png`
- `preview-drawer.png`

> 截图仅作设计评审，不建议随 PR 提交。

## 设计旋钮

App workspace：variance 3 / motion 2 / density 7 · Linear 风格克制信息台。
