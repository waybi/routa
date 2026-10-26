# Routa 设计规范（DESIGN.md）

给界面卡定样式用的成文规范，内容全部从现有代码整理，以主干 ac637e6c（看板列样式改版）之后的实际样式为准。
看板设计师岗位（`kanban-designer`）写 `## Design Spec` 前先读本文件；出题人、开发执行员、前端质量守卫按卡上的 Design Spec 出题、施工、核对。

规则的出处写成「文件:行号」或组件名。行号会随代码漂移：引用前用 `grep -n` 在当前代码里核一次，以代码为准。

## 1. 主题与变量的挂法

- 两套主题：浅色挂在 `html.light`，深色挂在 `html.dark`，由 `src/app/layout.tsx` 的内联主题脚本在首屏前加类名（`layout.tsx:20-30`），不挂在 `:root`（`src/app/globals.css:133-139` 的注释）。
- 组件里不写十六进制色值，只用 Tailwind 语义类（`bg-accent`、`text-secondary`、`border-default` …）。语义类到变量的映射在 `@theme inline` 块（`src/app/globals.css:231-252`），例如 `--color-accent: var(--accent)`（`globals.css:240`）。
- 字体：`system-ui, -apple-system, sans-serif`（`globals.css:261`）；卡号、提交号这类等宽内容用 `font-mono`（`kanban-card.tsx` 的 `kanban-card-id`）。

## 2. 颜色变量

### 2.1 强调色（accent）

| 变量 | 浅色 | 深色 | Tailwind 类 | 用途 |
|---|---|---|---|---|
| `--accent` | `#5153b5`（`globals.css:171`） | `#a5a7ff`（`globals.css:149`） | `bg-accent` / `text-accent` / `border-accent` / `outline-accent`（`globals.css:240`） | 主按钮底色、选中态文字、标签页下划线、焦点框 |
| `--accentbg` | `#ececfc`（`globals.css:172`） | `#30314b`（`globals.css:150`） | `bg-accent-subtle`（`globals.css:241`） | 选中态浅紫底、信息徽标底 |
| `--on` | `#ffffff`（`globals.css:173`） | `#171723`（`globals.css:151`） | `text-on-accent`（`globals.css:242`） | 主按钮上的文字 |

- 选中态写法：`bg-accent-subtle text-accent`，例如 `src/app/messages/page.tsx:99` 的筛选按钮；视图切换条、侧栏选中项照这个写法。
- 焦点框统一 `focus-visible:outline-2 focus-visible:outline-accent`（`button.tsx:27` 的 `BASE`）。

### 2.2 文字层级

| 变量 | 浅色 | 深色 | Tailwind 类 | 用途 |
|---|---|---|---|---|
| `--ink` | `#1c1e25`（`globals.css:168`） | `#eeeef1`（`globals.css:146`） | `text-primary`（`globals.css:237`） | 正文、标题、卡片标题 |
| `--muted` | `#5e6470`（`globals.css:169`） | `#a0a5b0`（`globals.css:147`） | `text-secondary`（`globals.css:238`） | 次要文字、说明、元信息、未选中标签页 |

### 2.3 背景

| 变量 | 浅色 | 深色 | Tailwind 类 | 用途 |
|---|---|---|---|---|
| `--bg` | `#fafafb`（`globals.css:163`） | `#111214`（`globals.css:141`） | `bg-canvas`（`globals.css:232`） | 页面底色、卡片详情工具栏底色 |
| `--side` | `#f1f2f5`（`globals.css:164`） | `#151619`（`globals.css:142`） | `bg-sidebar`（`globals.css:233`） | 侧栏 |
| `--panel` | `#ffffff`（`globals.css:165`） | `#191b1f`（`globals.css:143`） | `bg-surface`（`globals.css:234`） | 面板、次按钮底色、输入框 |
| `--soft` | `#f4f5f8`（`globals.css:166`） | `#202228`（`globals.css:144`） | `bg-subtle`（`globals.css:235`） | 中性徽标底、卡片上的工作区标签 |
| `--hover` | `#eaecf2`（`globals.css:167`） | `#252830`（`globals.css:145`） | `bg-hover`（`globals.css:236`） | 悬停底色 |

### 2.4 描边

| 变量 | 浅色 | 深色 | Tailwind 类 | 用途 |
|---|---|---|---|---|
| `--line` | `#dce0e7`（`globals.css:170`） | `#30333b`（`globals.css:148`） | `border-default`（`globals.css:239`） | 面板、次按钮、工具栏底线、标签页基线 |

### 2.5 语义状态色

| 变量 | 浅色 | 深色 | Tailwind 类 | 用途 |
|---|---|---|---|---|
| `--red` / `--redbg` | `#ae2f45` / `#fff0f2`（`globals.css:174-175`） | `#ffa5ad` / `#38232b`（`globals.css:152-153`） | `text-danger` / `bg-danger-subtle`（`globals.css:243-244`） | 危险：见 2.7 的使用边界 |
| `--amber` / `--amberbg` | `#82530b` / `#fff5e3`（`globals.css:176-177`） | `#f1c17a` / `#332c20`（`globals.css:154-155`） | `text-attention` / `bg-attention-subtle`（`globals.css:245-246`） | 需要确认、警告 |
| `--green` / `--greenbg` | `#176a45` / `#eaf8f0`（`globals.css:178-179`） | `#81d9ae` / `#1c332b`（`globals.css:156-157`） | `text-success` / `bg-success-subtle`（`globals.css:247-248`） | 通过、成功 |
| `--blue` | `#245f9e`（`globals.css:180`） | `#9ac5ff`（`globals.css:158`） | `text-information`（`globals.css:249`） | 信息、运行中 |

### 2.6 看板列状态色（`--lane-*`）

列的颜色只跟列的阶段（stage）走，不跟列的显示名走：组件只引用 `var(--lane-<stage>)`，由 `kanban-lane-tone.ts` 的 `laneToneVar()` 生成；未知阶段一律按 backlog（灰）处理（`resolveLaneTone()`）。

| 变量 | 浅色（`globals.css:194-199`） | 深色（`globals.css:213-218`） |
|---|---|---|
| `--lane-backlog` | `#9aa3ae`（`globals.css:194`） | `#62666d`（`globals.css:213`） |
| `--lane-todo` | `#266df0`（`globals.css:195`） | `#d0d6e0`（`globals.css:214`） |
| `--lane-dev` | `#f5a623`（`globals.css:196`） | `#f7bf8b`（`globals.css:215`） |
| `--lane-review` | `#9b69ff`（`globals.css:197`） | `#8fa6ff`（`globals.css:216`） |
| `--lane-done` | `#25c17c`（`globals.css:198`） | `#6366f1`（`globals.css:217`） |
| `--lane-blocked` | `#e5484d`（`globals.css:199`） | `#f34f52`（`globals.css:218`） |

- 列头标记用 `KanbanLaneMarker`（`kanban-lane-marker.tsx`）：浅色是 8×8 方点（圆角 2px），深色是 10×10 圆环（Done 实心、Backlog 虚线）。新的列头、阶段标识直接复用它，不另画圆点。
- `--lane-blocked` 只表示「卡住」这个阶段，不当危险按钮色用。

### 2.7 危险色的使用边界

- 两组危险色：语义类 `text-danger` / `bg-danger-subtle` / `border-danger`（来自 `--red`、`--redbg`）；旧版 `--danger-*` 一组（浅色 `globals.css:91-100`，如 `--danger-solid` 在 `globals.css:97`；深色 `globals.css:122-130`）。新代码用语义类。
- 危险色只用于删除和不可撤回的操作：`Button` 的 `danger` 变体（`button.tsx:32`），卡片悬停时出现的删除图标（`kanban-card.tsx` 的 `kanban-card-delete`，`text-danger hover:bg-danger-subtle`）。
- 失败状态的文字、徽标可以用 `Badge tone="danger"`（`badge.tsx:19`），但要带文字，不能只靠颜色。
- 关闭、收起、取消、返回都不是危险操作，不用红色。

## 3. 按钮

统一用 `src/client/components/ui/button.tsx` 的 `Button` 组件或 `buttonClassName(variant, size)`，不手写按钮类名。

| 变体 | 类名（`button.tsx:29-34`） | 什么时候用 |
|---|---|---|
| `primary`（主按钮） | `border-accent bg-accent font-semibold text-on-accent hover:opacity-90` | 一块区域里唯一的主操作（保存、创建、提交） |
| `secondary`（次按钮） | `border-default bg-surface text-primary hover:bg-hover` | 工具栏里的普通操作，如卡片详情的全屏、刷新、显示会话栏（`kanban-card-detail-toolbar.tsx:8` 的 `DETAIL_PANE_BUTTON_CLASS`） |
| `ghost`（图标按钮/幽灵按钮） | `border-transparent bg-transparent text-secondary hover:bg-hover hover:text-primary` | 关闭、收起、取消、更多这类轻操作；纯图标按钮必须带 `aria-label`（例：`inbox-bulk-bar.tsx` 的取消按钮用 `buttonClassName("ghost", "sm")`） |
| `danger`（危险按钮） | `border-danger bg-surface text-danger hover:bg-danger-subtle` | 只用于删除、不可撤回操作；描边红字，不用红色实心底 |

- 尺寸四档（`button.tsx:36-41`）：`xs` 24px 高 11px 字、`sm` 28px 高 12px 字、`md` 34px 高 13px 字（默认）、`lg` 40px 高 14px 字。工具栏里用 `sm`。
- 旧名 `desktop-secondary`、`desktop-accent` 只是别名（`button.tsx:43-47`），新代码不用。
- 关闭按钮：用图标按钮（`lucide-react` 的 `X` 图标，`ghost` 变体，或与所在工具栏同款的按钮类），不用红色、不用 `danger` 变体，不放大成红底大按钮。现状：卡片详情工具栏的「关闭卡片详情」是这一栏唯一的主操作，用 `buttonClassName("primary", "sm")` 加 `X` 图标和文字（`kanban-card-detail-toolbar.tsx:10-11`）；其他位置的关闭按钮照 `ghost` 写。

## 4. 圆角

| 变量 / 类 | 值 | 用在哪 |
|---|---|---|
| `--radius-control` → `rounded-control` | 7px（`globals.css:250`） | 按钮、输入框、视图切换项 |
| `--kanban-card-radius` | 浅色 10px（`globals.css:205`）、深色 6px（`globals.css:224`） | 看板卡片（`kanban-card.tsx` 的 `rounded-[var(--kanban-card-radius)]`） |
| `rounded-md` | 6px（Tailwind 默认） | 看板列、概览块（`kanban-board-surface.tsx`、`kanban-overview.tsx`） |
| `rounded` | 4px（Tailwind 默认） | 徽标（`badge.tsx:41`）、卡片内小标签 |
| `rounded-full` | 圆形 | 状态点（`badge.tsx:61`） |

差异说明：老板 2026-10-26 口述的风格基线是「6px 圆角」，代码里控件圆角 `--radius-control` 实际是 7px。本规范以代码为准写 7px，不改 CSS；要统一成 6px 须另开卡。

## 5. 间距

- 卡片：`py-2.5 pl-7 pr-2.5`，内部 `gap-1.5`（`kanban-card.tsx` 的 `cardClassName`）。
- 看板列：`p-2.5`，窄栏 `py-3`（`kanban-board-surface.tsx`）；概览块 `p-1.5`（`kanban-overview.tsx`）。
- 工具栏：`min-h-14 py-2 pl-4 pr-4`，按钮间 `gap-2`（`kanban-card-detail-toolbar.tsx` 的 header）。
- 标签页：标签之间 `gap-5`，标签纵向 `py-2.5`，紧凑模式 `py-1.5`（`tabs.tsx`）。
- 徽标：`px-1.5 py-0.5`，图标与文字 `gap-1`（`badge.tsx:41`）。

间距只用 Tailwind 的 0.5 步进刻度（`gap-1.5`、`p-2.5` 这类），不写 `p-[13px]` 这类任意值。

## 6. 字号

| 字号 | 用在哪 | 出处 |
|---|---|---|
| 13px，`font-[550]` | 看板卡片标题 | `kanban-card.tsx` 的 `kanban-card-title` |
| 13px | 标签页、`md` 按钮、工具栏标题 | `tabs.tsx`、`button.tsx:39`、`kanban-card-detail-toolbar.tsx` |
| 12px（`text-xs`） | `sm` 按钮、状态点说明 | `button.tsx:38`、`badge.tsx:60` |
| 11px | 徽标、卡片摘要和元信息、`xs` 按钮 | `badge.tsx:41`、`kanban-card.tsx`、`button.tsx:37` |
| 10px | 卡片顶部元信息行 | `kanban-card.tsx` 的 `kanban-card-meta` |

## 7. 卡片

- 看板卡片的外观全部走 `--kanban-card-*` 变量：底 `--kanban-card-bg`、悬停 `--kanban-card-hover`、描边 `--kanban-card-border`、圆角 `--kanban-card-radius`、阴影 `--kanban-card-shadow`（浅色 `globals.css:202-206`，深色 `globals.css:221-225`）。
- 浅色借 Attio：白卡、10px 圆角、柔和阴影；深色借 Linear：半透明卡、6px 圆角、无阴影。
- 看板列：`--kanban-col-bg` / `--kanban-col-border`（浅色 `globals.css:200-201`：浅灰底、不描边；深色 `globals.css:219-220`：无底、无描边）。
- 概览块：`--kanban-block-bg` / `--kanban-block-border` / `--kanban-block-border-width`（浅色 `globals.css:207-209`，深色 `globals.css:226-228`）。
- 其他面板：`bg-surface border border-default`。

## 8. 标签与徽标

- 状态标签用 `Badge`（`badge.tsx`），五种语气：`neutral`、`info`、`attention`、`danger`、`success`（`badge.tsx:14-20`）；必须带文字。
- 状态点加文字用 `StatusDot`（`badge.tsx:57-65`）；进行中的状态加 `pulse`，并尊重减少动态效果设置（`motion-safe:animate-pulse`）。
- 标签页用 `Tabs`（`tabs.tsx`）：选中项 `border-accent text-primary` 加 2px 下划线，未选中 `text-secondary`；基线是 1px 内阴影，不是 border。
- 看板列头的阶段标识用 `KanbanLaneMarker`（见 2.6）。

## 9. 深浅两套主题的差异

| 项 | 浅色 | 深色 |
|---|---|---|
| 强调色 `--accent` | `#5153b5` 靛紫 | `#a5a7ff` 浅靛紫 |
| 看板列 | 浅灰底不描边（Attio） | 无底无描边（Linear） |
| 列头标记 | 方点 | 圆环（Done 实心、Backlog 虚线） |
| 卡片 | 白底、10px、柔和阴影 | 3% 白半透明、6px、无阴影 |
| 概览块 | 浅灰底、无描边 | 2% 白半透明、1px 描边 |
| 危险色旧变量 `--danger-*` | 实色 | `color-mix` 半透明（`globals.css:122-125`） |

每加一处样式，两套主题都要截图看一遍；只在一套主题里定义的变量不许用。

## 10. 禁止

- 不另起新颜色、新圆角、新按钮变体：颜色只用第 2 节的变量和对应语义类，圆角只用第 4 节的几档，按钮只用 `Button` 的 primary / secondary / ghost / danger 四种。
- 危险色只用于删除和不可撤回操作；关闭、收起、取消、返回、失败提示的按钮都不用红色。
- 关闭按钮用图标按钮，不用红色：`X` 图标配 `ghost`（或所在工具栏同款按钮类），不做成红底大按钮（2026-10-20 卡 4bbc5c64 就是把卡片详情关闭按钮做成了红底大按钮）。
- 不把按钮换成黑色按钮，不换成胶囊圆角（`rounded-full` 的按钮）。
- 组件里不写十六进制色值、不写 `bg-red-500` 这类 Tailwind 原色类，一律用语义类。
- 改版已有界面时，旧版有的功能一律保留且直接可见，不删、不收进折叠区；窄区域（卡片详情、面板顶部标签条）要加解释时，优先用悬停提示，不加可见文字、不增宽。
