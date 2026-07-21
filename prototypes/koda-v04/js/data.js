/* Koda 活原型 v0.4 — 种子数据与常量 */

export const COLUMNS = [
  { id: 'BACKLOG', name: 'Backlog', dot: 'var(--st-queued)', hint: '可拖拽排序' },
  { id: 'DEV', name: 'Dev', dot: 'var(--st-dev)', bot: true },
  { id: 'REVIEW', name: 'Review', dot: 'var(--st-review)', bot: true },
  { id: 'ACCEPT', name: '待验收', dot: 'var(--st-await)', human: true },
  { id: 'DONE', name: 'Done', dot: 'var(--st-done)' },
];

export const STATE_COLUMN = {
  QUEUED: 'BACKLOG',
  BLOCKED: 'BACKLOG',
  READY: 'DEV',
  RUNNING: 'DEV',
  FIXING: 'DEV',
  REVIEWING: 'REVIEW',
  AWAITING_ACCEPTANCE: 'ACCEPT',
  MERGING: 'ACCEPT',
  DONE: 'DONE',
  CANCELLED: 'DONE',
};

export const STATE_LABEL = {
  QUEUED: '排队中',
  BLOCKED: '已阻塞',
  READY: '待派发',
  RUNNING: '开发中',
  FIXING: '修复中',
  REVIEWING: '审查中',
  AWAITING_ACCEPTANCE: '待验收',
  MERGING: '合并中',
  DONE: '完成',
  CANCELLED: '已取消',
};

export const OVERLAY_LABEL = {
  HELP: '求助',
  FAILED: '失败',
  PAUSED: '已暂停',
  TAKEN_OVER: '人在环',
};

/* ---------- diff 工具 ---------- */
function L(type, lineNumber, code) {
  return { type, lineNumber, code };
}

/* ---------- 通用脚本池（用户新建卡使用） ---------- */
export const GENERIC_DEV_STEPS = [
  { tail: '扫描仓库结构，定位相关文件…', ticks: 2 },
  { tail: '创建隔离 worktree，生成实现骨架…', ticks: 2 },
  { tail: '编写核心实现…', ticks: 3 },
  { tail: '补充单元测试…', ticks: 2 },
  { tail: '运行测试套件: 18/18 通过 ✓', ticks: 2 },
  { tail: '整理变更，宣告完成', ticks: 1 },
];

export const GENERIC_FIX_STEPS = [
  { tail: '定位审查意见指出的问题…', ticks: 2 },
  { tail: '应用修复并重新跑测试: 通过 ✓', ticks: 2 },
];

export const GENERIC_CRITERIA = [
  { text: '运行 npm test 全部通过', status: 'pending', evidence: 'tests/run.log' },
  { text: '新增逻辑有单元测试覆盖', status: 'pending', evidence: 'tests/*.test.ts' },
  { text: '无 TypeScript 编译错误', status: 'pending', evidence: 'tsc --noEmit' },
];

export const GENERIC_DIFF = [
  {
    path: 'src/feature/index.ts',
    flag: 'M',
    add: 34,
    del: 4,
    lines: [
      L('h', null, '@@ -12,7 +12,19 @@'),
      L('c', 12, 'export function process(input: Payload) {'),
      L('d', 13, '  const result = legacyTransform(input);'),
      L('a', 13, '  const result = structuredTransform(input, {'),
      L('a', 14, '    validate: true,'),
      L('a', 15, '    retries: 2,'),
      L('a', 16, '  });'),
      L('c', 17, '  return result;'),
      L('c', 18, '}'),
    ],
  },
  {
    path: 'tests/feature.test.ts',
    flag: 'A',
    add: 41,
    del: 0,
    lines: [
      L('h', null, '@@ -0,0 +1,6 @@'),
      L('a', 1, "import { describe, it, expect } from 'vitest';"),
      L('a', 2, "import { process } from '../src/feature';"),
      L('a', 3, ''),
      L('a', 4, "describe('process', () => {"),
      L('a', 5, "  it('handles empty payload', () => {"),
      L('a', 6, '    expect(process(empty())).toBeNull();'),
    ],
  },
];

/* ---------- 卡片工厂 ---------- */
let seq = 1;
function card(partial) {
  const id = partial.id || `c${seq++}`;
  return {
    id,
    projectId: 'koda',
    title: '未命名任务',
    goal: '',
    priority: 'normal',
    state: 'QUEUED',
    overlays: [],
    dependsOn: [],
    manualOrder: seq,
    budget: 3.0,
    cost: 0,
    tokens: 0,
    worktree: null,
    runs: [],
    activity: [],
    criteria: [],
    diff: [],
    files: [],
    devSteps: [],
    devIdx: 0,
    fixSteps: [],
    fixIdx: 0,
    reviewFailsLeft: 0,
    rejects: 0,
    liveTail: '',
    helpQuestion: null,
    takeoverMessages: null,
    notified: false,
    createdAt: '今早',
    fresh: false,
    ...partial,
  };
}

function run(kind, model, cost, stateLabel, tokens) {
  return { kind, model, cost, state: stateLabel, tokens };
}

/* ---------- 初始状态 ---------- */
export function createInitialState() {
  const projects = [
    { id: 'koda', name: 'koda', desc: '本地 AI 开发工厂', branch: 'main' },
    { id: 'web', name: 'web-site', desc: '官网', branch: 'main' },
    { id: 'api', name: 'api-gateway', desc: '网关服务', branch: 'develop' },
  ];

  const cards = [
    /* ── Backlog ─────────────────────────────── */
    card({
      id: 'c-cache',
      title: '缓存穿透防护：空值缓存 + 布隆过滤器',
      goal: '热点 key 失效后大量请求直打 DB。为空值加短 TTL 缓存，并在入口加布隆过滤器拦截不存在的 key。',
      state: 'QUEUED',
      priority: 'high',
      dependsOn: ['c-ratelimit'],
      manualOrder: 1,
      createdAt: '昨天',
      criteria: GENERIC_CRITERIA.map((c) => ({ ...c })),
      devSteps: GENERIC_DEV_STEPS.map((s) => ({ ...s })),
      activity: [
        { at: '09:12', who: 'system', text: '入场：Backlog 排队（依赖「API 限流中间件」未完成）' },
      ],
    }),
    card({
      id: 'c-statusbar',
      title: '状态栏成本统计改成本周累计',
      goal: '状态栏的「今日 $x」改成本周累计，悬浮显示按日明细。',
      state: 'QUEUED',
      manualOrder: 2,
      createdAt: '今早',
      criteria: GENERIC_CRITERIA.map((c) => ({ ...c })),
      devSteps: [
        { tail: '定位 StatusBar 组件与成本聚合逻辑…', ticks: 2 },
        { tail: '实现周累计聚合 + 按日明细 tooltip…', ticks: 3 },
        { tail: '运行测试: 通过 ✓', ticks: 2 },
        { tail: '宣告完成', ticks: 1 },
      ],
      activity: [
        { at: '09:20', who: 'system', text: '入场：Backlog 排队，等待槽位' },
      ],
    }),
    card({
      id: 'c-blocked-demo',
      title: '依赖失败演示：旧数据清理脚本',
      goal: '（演示用：上游失败后显式 BLOCKED，不会永久 PENDING）',
      state: 'BLOCKED',
      manualOrder: 3,
      createdAt: '前天',
      dependsOn: ['c-anim'],
      criteria: GENERIC_CRITERIA.map((c) => ({ ...c })),
      devSteps: GENERIC_DEV_STEPS.map((s) => ({ ...s })),
      activity: [
        { at: '周三', who: 'system', text: '入场：Backlog 排队' },
        { at: '10:41', who: 'system', text: '依赖「引导页动画」FAILED → 本卡 BLOCKED，等待裁决' },
      ],
    }),

    /* ── Dev ─────────────────────────────────── */
    card({
      id: 'c-ratelimit',
      title: 'API 限流中间件（滑动窗口）',
      goal: '给公开 API 加滑动窗口限流，超限返回 429 + Retry-After；阈值按路由组可配。',
      state: 'RUNNING',
      priority: 'high',
      worktree: 'wt/c-ratelimit',
      cost: 0.62,
      tokens: 48210,
      manualOrder: 0,
      createdAt: '今早',
      liveTail: '编写测试: 窗口边界与突发流量…',
      criteria: [
        { text: '超限请求返回 429 且带 Retry-After', status: 'pending', evidence: 'tests/ratelimit.test.ts' },
        { text: '滑动窗口在边界时刻计数正确', status: 'pending', evidence: 'tests/window.test.ts' },
        { text: '阈值可按路由组配置', status: 'pending', evidence: 'config/routes.ts' },
      ],
      runs: [run('develop', 'claude-sonnet', 0.62, 'going', 48210)],
      devSteps: [
        { tail: '扫描中间件注册链路…', ticks: 2 },
        { tail: '实现滑动窗口计数器（Redis 后端）…', ticks: 3 },
        { tail: '编写测试: 窗口边界与突发流量…', ticks: 3 },
        { tail: '运行全量测试套件…', ticks: 2 },
        { tail: '宣告完成', ticks: 1 },
      ],
      devIdx: 2,
      files: [
        { path: 'src/middleware/ratelimit.ts', flag: 'A', add: 88, del: 0 },
        { path: 'src/middleware/index.ts', flag: 'M', add: 6, del: 1 },
        { path: 'tests/ratelimit.test.ts', flag: 'A', add: 64, del: 0 },
      ],
      diff: [
        {
          path: 'src/middleware/ratelimit.ts',
          flag: 'A',
          add: 88,
          del: 0,
          lines: [
            L('h', null, '@@ -0,0 +1,8 @@'),
            L('a', 1, 'import type { Middleware } from "../types";'),
            L('a', 2, 'import { slidingWindow } from "./window";'),
            L('a', 3, ''),
            L('a', 4, 'export function rateLimit(opts: RateLimitOptions): Middleware {'),
            L('a', 5, '  return async (ctx, next) => {'),
            L('a', 6, '    const hit = await slidingWindow(ctx.routeGroup, ctx.ip);'),
            L('a', 7, '    if (hit.exceeded) return ctx.reply(429, { retryAfter: hit.ttl });'),
            L('a', 8, '    return next();'),
          ],
        },
      ],
      activity: [
        { at: '09:31', who: 'system', text: '调度：依赖就绪 + 槽位空闲 → READY，创建 worktree wt/c-ratelimit' },
        { at: '09:31', who: 'system', text: '派发 developer · Run #1 (develop, claude-sonnet)' },
        { at: '09:34', who: 'dev', text: '已读完中间件注册链路，准备实现滑动窗口计数器' },
      ],
    }),
    card({
      id: 'c-i18n',
      title: 'i18n 字符串抽取与迁移',
      goal: '把散落在组件里的中文硬编码抽到 locale 文件。agent 发现两条互斥路径，已升级求助。',
      state: 'RUNNING',
      overlays: ['HELP'],
      worktree: 'wt/c-i18n',
      cost: 1.04,
      tokens: 71930,
      createdAt: '今早',
      liveTail: '🆘 等待人的裁决…',
      helpQuestion: {
        text: '存量翻译键的处理我拿不准，两条路都能走：\nA. 迁移方案：写脚本把旧键批量改名到新命名空间（彻底，但要跑数据订正）\nB. 兼容方案：保留旧键 + 适配层（安全，但留技术债）\n倾向 A，但旧数据量我不确定。',
        askedAt: '10:47',
      },
      criteria: [
        { text: '组件内无硬编码中文字面量', status: 'pending', evidence: 'lint-no-hardcode' },
        { text: 'locale 文件通过 schema 校验', status: 'pending', evidence: 'scripts/check-locale.ts' },
      ],
      runs: [run('develop', 'claude-sonnet', 1.04, 'going', 71930)],
      devSteps: [],
      activity: [
        { at: '09:40', who: 'system', text: '派发 developer · Run #1 (develop)' },
        { at: '10:47', who: 'agent', text: '升级求助：存量翻译键迁移 vs 兼容，两条路互斥', help: true },
      ],
    }),
    card({
      id: 'c-export',
      title: '批量导出 CSV/JSON',
      goal: '数据页支持勾选批量导出。成本超过单卡预算 $3.00，已被护栏暂停。',
      state: 'FIXING',
      overlays: ['PAUSED'],
      worktree: 'wt/c-export',
      cost: 3.21,
      budget: 3.0,
      tokens: 201440,
      createdAt: '昨天',
      liveTail: '⏸ 成本超预算，等人决定',
      criteria: GENERIC_CRITERIA.map((c) => ({ ...c })),
      runs: [
        run('develop', 'claude-sonnet', 2.1, 'ok', 131200),
        run('review', 'claude-opus', 0.44, 'bad', 30120),
        run('fix', 'claude-sonnet', 0.67, 'going', 40120),
      ],
      activity: [
        { at: '昨天', who: 'system', text: '派发 developer · Run #1 (develop)' },
        { at: '昨天', who: 'review', text: '审查不通过：大文件导出未做流式，10w 行会 OOM' },
        { at: '昨天', who: 'system', text: '自动打回 FIXING · Run #3 (fix)' },
        { at: '08:52', who: 'system', text: '成本 $3.21 超预算 $3.00 → PAUSED，已进收件箱' },
      ],
    }),

    /* ── Review ──────────────────────────────── */
    card({
      id: 'c-darkmode',
      title: '暗色模式适配（全站 token 化）',
      goal: '把写死的颜色全部换成 design token，暗色下对比度达 WCAG AA。',
      state: 'REVIEWING',
      worktree: 'wt/c-darkmode',
      cost: 0.96,
      tokens: 60120,
      createdAt: '今早',
      liveTail: '🔍 审查员核查中: 对比度 3/5 项…',
      criteria: [
        { text: '无硬编码色值（lint 通过）', status: 'pass', evidence: 'lint-colors: 0 warnings' },
        { text: '正文对比度 ≥ 4.5:1', status: 'pass', evidence: 'a11y-report.md#L12' },
        { text: '图表配色在暗色下可区分', status: 'pass', evidence: 'screenshot: charts-dark.png' },
        { text: '焦点环在两种主题下可见', status: 'pending', evidence: 'manual check' },
        { text: '运行视觉回归测试', status: 'pending', evidence: 'vitest --project=visual' },
      ],
      runs: [
        run('develop', 'claude-sonnet', 0.71, 'ok', 44200),
        run('review', 'claude-opus', 0.25, 'going', 15920),
      ],
      reviewFailsLeft: 0,
      files: [
        { path: 'src/styles/tokens.css', flag: 'M', add: 46, del: 31 },
        { path: 'src/components/Chart.tsx', flag: 'M', add: 12, del: 9 },
      ],
      diff: [
        {
          path: 'src/styles/tokens.css',
          flag: 'M',
          add: 46,
          del: 31,
          lines: [
            L('h', null, '@@ -4,9 +4,12 @@'),
            L('c', 4, ':root {'),
            L('d', 5, '  --panel: #ffffff;'),
            L('d', 6, '  --text: #1a1a1a;'),
            L('a', 5, '  --panel: var(--surface-1);'),
            L('a', 6, '  --text: var(--fg-1);'),
            L('a', 7, '  color-scheme: light dark;'),
            L('c', 8, '}'),
          ],
        },
      ],
      activity: [
        { at: '10:02', who: 'dev', text: '宣告完成：37 个组件已 token 化' },
        { at: '10:02', who: 'system', text: '派发 reviewer · Run #2 (review, claude-opus)' },
      ],
    }),

    /* ── 待验收 ──────────────────────────────── */
    card({
      id: 'c-settings',
      title: '设置页表单校验 + 脏检查',
      goal: '设置页各分区加字段级校验与离开确认，防止误改 API key 后直接丢失。',
      state: 'AWAITING_ACCEPTANCE',
      worktree: 'wt/c-settings',
      cost: 0.84,
      tokens: 52310,
      createdAt: '昨天',
      liveTail: '✓ 审查通过，等你验收',
      criteria: [
        { text: '必填项为空时禁用保存并高亮', status: 'pass', evidence: 'tests/settings-form.test.ts:23' },
        { text: 'API key 字段脱敏显示', status: 'pass', evidence: 'tests/settings-form.test.ts:41' },
        { text: '未保存离开弹确认', status: 'pass', evidence: 'tests/dirty-check.test.ts:8' },
        { text: '暗色模式下错误态可读', status: 'human', evidence: '截图已附，需人确认观感' },
        { text: '测试 12/12 通过', status: 'pass', evidence: 'vitest: 12 passed' },
      ],
      runs: [
        run('develop', 'claude-sonnet', 0.55, 'ok', 34200),
        run('review', 'claude-opus', 0.29, 'ok', 18110),
      ],
      notified: true,
      files: [
        { path: 'src/pages/Settings.tsx', flag: 'M', add: 142, del: 12 },
        { path: 'src/pages/settings/validation.ts', flag: 'A', add: 57, del: 0 },
        { path: 'tests/settings-form.test.ts', flag: 'A', add: 74, del: 0 },
      ],
      diff: [
        {
          path: 'src/pages/Settings.tsx',
          flag: 'M',
          add: 142,
          del: 12,
          lines: [
            L('h', null, '@@ -31,8 +31,21 @@'),
            L('c', 31, 'function ProviderSection({ form }: Props) {'),
            L('d', 32, '  const [key, setKey] = useState(form.apiKey);'),
            L('a', 32, '  const [key, setKey] = useDirtyField(form.apiKey, {'),
            L('a', 33, '    mask: true,'),
            L('a', 34, '    validate: isApiKey,'),
            L('a', 35, '  });'),
            L('c', 36, '  return ('),
            L('d', 37, '    <Input value={key} onChange={setKey} />'),
            L('a', 38, '    <Field'),
            L('a', 39, '      invalid={!key.valid}'),
            L('a', 40, '      hint={key.dirty ? "未保存" : undefined}'),
            L('a', 41, '    >'),
            L('a', 42, '      <MaskedInput value={key.value} onChange={setKey} />'),
            L('a', 43, '    </Field>'),
            L('c', 44, '  );'),
          ],
        },
        {
          path: 'src/pages/settings/validation.ts',
          flag: 'A',
          add: 57,
          del: 0,
          lines: [
            L('h', null, '@@ -0,0 +1,5 @@'),
            L('a', 1, 'export function isApiKey(v: string): boolean {'),
            L('a', 2, "  return /^sk-[a-zA-Z0-9]{24,}$/.test(v.trim());"),
            L('a', 3, '}'),
            L('a', 4, ''),
            L('a', 5, 'export function useDirtyField<T>(init: T, opts: Opts) {'),
          ],
        },
      ],
      activity: [
        { at: '昨天', who: 'dev', text: '宣告完成' },
        { at: '昨天', who: 'review', text: '审查通过（4/5 机器验证，1 项标记「需人工判断」）' },
        { at: '昨天', who: 'system', text: '进入待验收 · 已发送桌面通知' },
      ],
    }),
    card({
      id: 'c-lazyimg',
      title: '落地页图片懒加载 + AVIF 降级',
      goal: '首屏外的图片全部懒加载，支持 AVIF 时优先、JPEG 降级；LCP 目标 < 1.2s。',
      state: 'AWAITING_ACCEPTANCE',
      worktree: 'wt/c-lazyimg',
      cost: 0.47,
      tokens: 30240,
      createdAt: '昨天',
      liveTail: '✓ 审查通过，等你验收',
      criteria: [
        { text: 'Lighthouse LCP < 1.2s', status: 'pass', evidence: 'lighthouse-report.json' },
        { text: '<picture> 正确输出 AVIF/JPEG 双源', status: 'pass', evidence: 'tests/image.test.ts:17' },
        { text: '首屏外图片初始不请求', status: 'pass', evidence: 'network-har: 0 idle reqs' },
      ],
      runs: [
        run('develop', 'claude-sonnet', 0.31, 'ok', 20100),
        run('review', 'claude-opus', 0.16, 'ok', 10140),
      ],
      notified: true,
      files: [
        { path: 'src/components/LazyImage.tsx', flag: 'A', add: 63, del: 0 },
        { path: 'src/pages/Home.tsx', flag: 'M', add: 18, del: 22 },
      ],
      diff: [
        {
          path: 'src/components/LazyImage.tsx',
          flag: 'A',
          add: 63,
          del: 0,
          lines: [
            L('h', null, '@@ -0,0 +1,6 @@'),
            L('a', 1, 'export function LazyImage({ src, avif, alt }: Props) {'),
            L('a', 2, '  return ('),
            L('a', 3, '    <picture>'),
            L('a', 4, '      <source srcSet={avif} type="image/avif" />'),
            L('a', 5, '      <img src={src} alt={alt} loading="lazy" decoding="async" />'),
            L('a', 6, '    </picture>'),
          ],
        },
      ],
      activity: [
        { at: '昨天', who: 'review', text: '审查通过（3/3 全部机器验证）' },
        { at: '昨天', who: 'system', text: '进入待验收 · 已发送桌面通知' },
      ],
    }),

    /* ── Done / 异常种子 ─────────────────────── */
    card({
      id: 'c-scheduler-test',
      title: '单测补齐：调度器出队顺序',
      goal: '覆盖 priority → manualOrder → createdAt 的出队序与依赖门。',
      state: 'DONE',
      cost: 0.38,
      tokens: 24800,
      createdAt: '周二',
      liveTail: '',
      runs: [
        run('develop', 'claude-sonnet', 0.24, 'ok', 15600),
        run('review', 'claude-opus', 0.1, 'ok', 6100),
        run('merge', 'system', 0, 'ok', 0),
      ],
      activity: [
        { at: '周二', who: 'system', text: '验收通过 → squash 合并回 main · worktree 已清理' },
      ],
    }),
    card({
      id: 'c-readme',
      title: 'README 快速上手重写',
      goal: '5 分钟跑通的最小路径，配截图。',
      state: 'DONE',
      cost: 0.19,
      createdAt: '周二',
      activity: [
        { at: '周二', who: 'system', text: '验收通过 → squash 合并回 main' },
      ],
    }),
    card({
      id: 'c-anim',
      title: '引导页动画（watchdog 超时）',
      goal: '引导页三步动画。developer 卡在依赖安装 30 分钟无工具调用，被 watchdog 标 FAILED。',
      state: 'RUNNING',
      overlays: ['FAILED'],
      worktree: 'wt/c-anim',
      cost: 0.73,
      tokens: 41200,
      createdAt: '前天',
      liveTail: '❌ watchdog: 30 分钟无工具调用',
      runs: [run('develop', 'claude-sonnet', 0.73, 'bad', 41200)],
      criteria: GENERIC_CRITERIA.map((c) => ({ ...c })),
      activity: [
        { at: '前天', who: 'system', text: '派发 developer · Run #1 (develop)' },
        { at: '10:41', who: 'system', text: 'watchdog 触发（30min 无工具调用）→ FAILED，已进收件箱' },
      ],
    }),

    /* ── 其他项目（跨项目收件箱用） ──────────── */
    card({
      id: 'c-web-hero',
      title: '首页改版：hero 区重构',
      goal: 'hero 换成全屏视觉 + 单 CTA。',
      projectId: 'web',
      state: 'RUNNING',
      overlays: ['FAILED'],
      worktree: 'wt/c-web-hero',
      cost: 0.9,
      createdAt: '昨天',
      liveTail: '❌ agent 进程崩溃（重启 reconcile）',
      runs: [run('develop', 'claude-sonnet', 0.9, 'bad', 52000)],
      activity: [{ at: '1 小时前', who: 'system', text: '重启 reconcile：孤儿 Run 标 FAILED，不自动重跑' }],
    }),
    card({
      id: 'c-api-throttle',
      title: '网关限流改造（预算超限）',
      goal: '令牌桶替换固定窗口。',
      projectId: 'api',
      state: 'FIXING',
      overlays: ['PAUSED'],
      worktree: 'wt/c-api-throttle',
      cost: 4.1,
      budget: 3.0,
      createdAt: '昨天',
      liveTail: '⏸ 成本超限',
      runs: [run('develop', 'claude-sonnet', 4.1, 'going', 240000)],
      activity: [{ at: '昨天', who: 'system', text: '成本 $4.10 超预算 → PAUSED' }],
    }),
  ];

  const inbox = [
    {
      id: 'ib-1',
      type: 'AWAITING_ACCEPTANCE',
      projectId: 'koda',
      cardId: 'c-settings',
      title: '设置页表单校验 + 脏检查',
      time: '10 分钟前',
      unread: true,
      done: false,
    },
    {
      id: 'ib-2',
      type: 'AWAITING_ACCEPTANCE',
      projectId: 'koda',
      cardId: 'c-lazyimg',
      title: '落地页图片懒加载 + AVIF 降级',
      time: '26 分钟前',
      unread: true,
      done: false,
    },
    {
      id: 'ib-3',
      type: 'HELP',
      projectId: 'koda',
      cardId: 'c-i18n',
      title: 'i18n 字符串抽取与迁移',
      time: '32 分钟前',
      unread: true,
      done: false,
    },
    {
      id: 'ib-4',
      type: 'FAILED',
      projectId: 'koda',
      cardId: 'c-anim',
      title: '引导页动画（watchdog 超时）',
      time: '1 小时前',
      unread: true,
      done: false,
    },
    {
      id: 'ib-5',
      type: 'FAILED',
      projectId: 'web',
      cardId: 'c-web-hero',
      title: '首页改版：hero 区重构',
      time: '1 小时前',
      unread: false,
      done: false,
    },
    {
      id: 'ib-6',
      type: 'BUDGET',
      projectId: 'api',
      cardId: 'c-api-throttle',
      title: '网关限流改造',
      time: '昨天',
      unread: false,
      done: false,
    },
  ];

  return {
    projects,
    activeProjectId: 'koda',
    cards,
    inbox,
    inboxOpen: false,
    tabs: [{ id: 'board', kind: 'board', title: 'koda · 看板', closable: false }],
    activeTabId: 'board',
    drawer: { open: false, cardId: null, tab: 'overview', full: false },
    acceptSelectedId: null,
    rejectOpen: false,
    settings: {
      section: 'general',
      slots: 2,
      watchdog: 30,
      notify: true,
      deliveryMode: 'auto-merge',
      defaultBudget: 3.0,
      dailyCap: 20,
    },
    split: null, // { phase:'streaming'|'preview', request, lines:[], drafts:[], lineIdx }
    stats: {
      todayCost: 4.28,
      todayRuns: 11,
      weekCards: 12,
    },
    demo: { active: false },
  };
}

/* 拆卡用的 Planner 流式文案 */
export const PLANNER_STREAM_LINES = [
  '▸ 扫描仓库结构… src/components · src/pages · src/lib',
  '▸ 识别变更点: 2 个独立任务 + 1 条依赖链',
  '▸ 生成验收标准… 6 条，其中 5 条可机器验证',
];

export const PLANNER_DRAFTS = [
  {
    id: 'd1',
    title: '快捷键基础设施',
    goal: '全局快捷键注册中心 + 冲突检测，供各页面接入。',
    criteria: ['注册/注销 API 有单测覆盖', '同键冲突时后注册者覆盖并告警'],
    criteriaCount: 2,
    files: 3,
    dependsOn: null,
    warn: false,
  },
  {
    id: 'd2',
    title: '验收台快捷键接入',
    goal: '验收台接入 j/k/a/r/t/d，含焦点管理与提示条。',
    criteria: ['j/k 循环切换队列', 'a 通过并自动跳下一张', 'r 弹评语框后打回'],
    criteriaCount: 3,
    files: 2,
    dependsOn: 'd1',
    warn: false,
  },
  {
    id: 'd3',
    title: '快捷键提示悬浮面板',
    goal: '按 ? 弹出当前页可用快捷键一览。',
    criteria: ['面板位置与样式符合设计'],
    criteriaCount: 1,
    files: 1,
    dependsOn: null,
    warn: true,
  },
];
