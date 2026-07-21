/** Seed data for Koda product prototype v0.3 */

export const COLUMNS = [
  { id: 'backlog', title: 'Backlog', states: ['QUEUED', 'BLOCKED'] },
  { id: 'dev', title: 'Dev', states: ['READY', 'RUNNING', 'FIXING'] },
  { id: 'review', title: 'Review', states: ['REVIEWING'] },
  { id: 'accept', title: '待验收', states: ['AWAITING_ACCEPTANCE', 'MERGING'] },
  { id: 'done', title: 'Done', states: ['DONE', 'CANCELLED'] },
];

export const STATE_LABEL = {
  DRAFT: '拆卡预览',
  QUEUED: '排队',
  BLOCKED: '阻塞',
  READY: '已占槽',
  RUNNING: '开发中',
  FIXING: '修复中',
  REVIEWING: '审查中',
  AWAITING_ACCEPTANCE: '待验收',
  MERGING: '合并中',
  DONE: '完成',
  CANCELLED: '已取消',
};

export function createInitialState() {
  return {
    activeProjectId: 'proj-koda',
    projects: [
      {
        id: 'proj-koda',
        name: 'koda',
        repo: '~/Desktop/my/koda',
        branch: 'main',
        deliveryMode: 'auto-merge',
        slots: 2,
        costToday: 4.2,
      },
      {
        id: 'proj-routa-learn',
        name: 'routa-learn',
        repo: '~/Desktop/my/routa',
        branch: 'arch-classics',
        deliveryMode: 'pr',
        slots: 2,
        costToday: 1.1,
      },
    ],
    settingsTab: 'general',
    globalSlots: 2,
    provider: { name: 'claude-sonnet', healthy: true },
    feedDraft: '',
    planPreview: null,
    inboxOpen: false,
    drawer: { open: false, cardId: null, tab: 'overview' },
    tabs: [
      { id: 'board', kind: 'board', title: 'koda · 看板', closable: false },
    ],
    activeTabId: 'board',
    acceptSelectedId: 'card-settings',
    takeoverDraft: '',
    cards: [
      {
        id: 'card-cache',
        projectId: 'proj-koda',
        title: '缓存修复',
        goal: '修复会话列表二次打开空白的缓存失效路径',
        state: 'QUEUED',
        overlays: [],
        priority: 'normal',
        manualOrder: 10,
        dependsOn: ['card-rate'],
        cost: 0,
        liveTail: '等待依赖：API 限流',
        acceptance: [
          { text: '二次打开会话列表不出现空白', status: 'pending', evidence: '' },
          { text: '相关单测通过', status: 'pending', evidence: '' },
        ],
        files: ['src/cache/session.ts'],
        activity: [
          { at: '09:12', who: 'system', text: '入场，依赖未齐，状态 QUEUED' },
        ],
        runs: [{ id: 'r0', kind: 'plan', state: 'done' }],
        diff: null,
        helpQuestion: null,
      },
      {
        id: 'card-rate',
        projectId: 'proj-koda',
        title: 'API 限流',
        goal: '给外部 provider 调用加 token bucket',
        state: 'RUNNING',
        overlays: [],
        priority: 'high',
        manualOrder: 20,
        dependsOn: [],
        cost: 0.42,
        liveTail: '⚡ 正在写 rateLimiter.ts 测试…',
        acceptance: [
          { text: '超限返回 429 且带 Retry-After', status: 'pending', evidence: '' },
          { text: '单元测试覆盖突发与稳态', status: 'pending', evidence: '' },
        ],
        files: ['src/net/rateLimiter.ts', 'src/net/rateLimiter.test.ts'],
        activity: [
          { at: '09:05', who: 'scheduler', text: '占槽 → READY → RUNNING' },
          { at: '09:18', who: 'developer', text: '实现 token bucket，补充边界测试' },
        ],
        runs: [
          { id: 'r1', kind: 'develop', state: 'running' },
        ],
        diff: sampleDiffRate(),
        helpQuestion: null,
      },
      {
        id: 'card-i18n',
        projectId: 'proj-koda',
        title: 'i18n 抽取',
        goal: '把验收台硬编码文案抽到字典',
        state: 'RUNNING',
        overlays: ['HELP'],
        priority: 'normal',
        manualOrder: 30,
        dependsOn: [],
        cost: 0.61,
        liveTail: '🆘 两种 key 方案互斥，求裁决',
        acceptance: [
          { text: '验收台无硬编码中文/英文', status: 'pending', evidence: '' },
          { text: '切换语言后快捷键提示同步', status: 'pending', evidence: '' },
        ],
        files: ['src/i18n/accept.json', 'src/views/Accept.tsx'],
        activity: [
          { at: '09:40', who: 'developer', text: '抽到 accept.json，发现 nested vs flat key 冲突' },
          { at: '09:51', who: 'developer', text: '升级求助：倾向 nested，但会影响既有脚本' },
        ],
        runs: [{ id: 'r2', kind: 'develop', state: 'paused' }],
        diff: sampleDiffI18n(),
        helpQuestion: {
          title: 'i18n key 结构怎么定？',
          options: [
            'A. nested：accept.queue.title（可读，改脚本）',
            'B. flat：accept_queue_title（兼容旧脚本）',
          ],
          prefer: 'A',
        },
        takeoverMessages: [
          {
            who: 'agent',
            text: '我卡在 key 结构。nested 更清晰，但仓库里有 3 个脚本读 flat key。你倾向哪边？',
          },
        ],
      },
      {
        id: 'card-dark',
        projectId: 'proj-koda',
        title: '暗色模式',
        goal: '设置页暗色 token 对齐',
        state: 'REVIEWING',
        overlays: [],
        priority: 'low',
        manualOrder: 40,
        dependsOn: [],
        cost: 0.33,
        liveTail: '🔍 审查中 4/5 项',
        acceptance: [
          { text: '设置页对比度 ≥ 4.5:1', status: 'pass', evidence: 'axe 无严重项' },
          { text: '切换主题无闪白', status: 'pass', evidence: '手动录屏' },
          { text: '视觉回归 12/12', status: 'pending', evidence: '跑测中' },
        ],
        files: ['src/theme/tokens.css', 'src/pages/Settings.tsx'],
        activity: [
          { at: '10:02', who: 'developer', text: '宣告完成，进入 REVIEWING' },
          { at: '10:04', who: 'reviewer', text: '对照验收标准核查 diff + 测试' },
        ],
        runs: [
          { id: 'r3', kind: 'develop', state: 'done' },
          { id: 'r4', kind: 'review', state: 'running' },
        ],
        diff: sampleDiffDark(),
        helpQuestion: null,
      },
      {
        id: 'card-settings',
        projectId: 'proj-koda',
        title: '设置页表单',
        goal: '项目 deliveryMode 表单与校验',
        state: 'AWAITING_ACCEPTANCE',
        overlays: [],
        priority: 'high',
        manualOrder: 50,
        dependsOn: [],
        cost: 0.8,
        liveTail: '✓ 审查通过，等人验收',
        acceptance: [
          { text: '表单校验生效', status: 'pass', evidence: 'zod schema + 3 cases' },
          { text: '暗色模式适配', status: 'pass', evidence: '截图对比' },
          { text: '测试 12/12 ✓', status: 'pass', evidence: 'vitest' },
        ],
        files: ['src/pages/Settings.tsx', 'src/pages/Settings.test.tsx'],
        activity: [
          { at: '08:50', who: 'reviewer', text: '全部标准通过，进入待验收' },
          { at: '08:50', who: 'system', text: 'InboxItem(AWAITING_ACCEPTANCE) + 桌面通知' },
        ],
        runs: [
          { id: 'r5', kind: 'develop', state: 'done' },
          { id: 'r6', kind: 'review', state: 'done' },
        ],
        diff: sampleDiffSettings(),
        helpQuestion: null,
      },
      {
        id: 'card-hotkeys',
        projectId: 'proj-koda',
        title: '验收台快捷键',
        goal: 'j/k 切卡，a 通过，r 打回',
        state: 'AWAITING_ACCEPTANCE',
        overlays: [],
        priority: 'normal',
        manualOrder: 60,
        dependsOn: [],
        cost: 0.55,
        liveTail: '✓ 审查通过；UI 提示位置可能需人眼',
        acceptance: [
          { text: 'j/k 切换队列卡片', status: 'pass', evidence: 'e2e hotkeys.spec' },
          { text: 'a 通过 / r 打回', status: 'pass', evidence: 'e2e hotkeys.spec' },
          { text: '快捷键提示位置不挡 diff', status: 'human', evidence: '需人工判断' },
        ],
        files: ['src/views/Accept.tsx', 'src/hooks/useAcceptHotkeys.ts'],
        activity: [
          { at: '10:20', who: 'reviewer', text: '机器项通过；提示位置标「需人工判断」' },
        ],
        runs: [
          { id: 'r7', kind: 'develop', state: 'done' },
          { id: 'r8', kind: 'review', state: 'done' },
        ],
        diff: sampleDiffHotkeys(),
        helpQuestion: null,
      },
      {
        id: 'card-costbar',
        projectId: 'proj-koda',
        title: '状态栏成本周累计',
        goal: '状态栏从今日合计改为本周累计可切换',
        state: 'DONE',
        overlays: [],
        priority: 'low',
        manualOrder: 70,
        dependsOn: [],
        cost: 0.22,
        liveTail: '已合并 main',
        acceptance: [
          { text: '状态栏可切换今日/本周', status: 'pass', evidence: 'merged' },
        ],
        files: ['src/shell/StatusBar.tsx'],
        activity: [
          { at: '昨天', who: 'system', text: '验收通过 → auto-merge → DONE' },
        ],
        runs: [],
        diff: null,
        helpQuestion: null,
      },
      {
        id: 'card-routa-notes',
        projectId: 'proj-routa-learn',
        title: 'Phase 2 笔记整理',
        goal: '把 reconcile 债务写成可迁移模式',
        state: 'QUEUED',
        overlays: [],
        priority: 'normal',
        manualOrder: 10,
        dependsOn: [],
        cost: 0,
        liveTail: '等待槽位',
        acceptance: [
          { text: '输出 3 条可迁移模式', status: 'pending', evidence: '' },
        ],
        files: ['docs/learning/notes.md'],
        activity: [],
        runs: [],
        diff: null,
        helpQuestion: null,
      },
    ],
    inbox: [
      {
        id: 'in1',
        type: 'AWAITING_ACCEPTANCE',
        projectId: 'proj-koda',
        cardId: 'card-settings',
        title: '设置页表单 待验收',
        sub: 'AI 审查通过 · $0.80',
        unread: true,
      },
      {
        id: 'in2',
        type: 'AWAITING_ACCEPTANCE',
        projectId: 'proj-koda',
        cardId: 'card-hotkeys',
        title: '验收台快捷键 待验收',
        sub: '1 项需人工判断',
        unread: true,
      },
      {
        id: 'in3',
        type: 'HELP',
        projectId: 'proj-koda',
        cardId: 'card-i18n',
        title: 'i18n 抽取 求助',
        sub: 'nested vs flat key',
        unread: true,
      },
    ],
  };
}

function sampleDiffRate() {
  return [
    {
      file: 'src/net/rateLimiter.ts',
      plus: 86,
      minus: 4,
      lines: [
        { type: 'ctx', ln: 1, text: 'export class TokenBucket {' },
        { type: 'add', ln: 2, text: '  constructor(private capacity: number, private refillPerSec: number) {}' },
        { type: 'add', ln: 3, text: '  tryTake(n = 1): boolean {' },
        { type: 'add', ln: 4, text: '    this.refill();' },
        { type: 'add', ln: 5, text: '    if (this.tokens < n) return false;' },
        { type: 'add', ln: 6, text: '    this.tokens -= n;' },
        { type: 'add', ln: 7, text: '    return true;' },
        { type: 'add', ln: 8, text: '  }' },
        { type: 'ctx', ln: 9, text: '}' },
      ],
    },
  ];
}

function sampleDiffI18n() {
  return [
    {
      file: 'src/i18n/accept.json',
      plus: 24,
      minus: 0,
      lines: [
        { type: 'add', ln: 1, text: '{' },
        { type: 'add', ln: 2, text: '  "queue": { "title": "队列" },' },
        { type: 'add', ln: 3, text: '  "actions": { "pass": "通过", "reject": "打回" }' },
        { type: 'add', ln: 4, text: '}' },
      ],
    },
  ];
}

function sampleDiffDark() {
  return [
    {
      file: 'src/theme/tokens.css',
      plus: 18,
      minus: 6,
      lines: [
        { type: 'del', ln: 12, text: '--surface: #fff;' },
        { type: 'add', ln: 12, text: '--surface: var(--bg-elev);' },
        { type: 'add', ln: 13, text: '--text-muted: color-mix(in oklab, var(--text) 62%, transparent);' },
      ],
    },
  ];
}

function sampleDiffSettings() {
  return [
    {
      file: 'src/pages/Settings.tsx',
      plus: 142,
      minus: 12,
      lines: [
        { type: 'ctx', ln: 40, text: 'export function ProjectSettings() {' },
        { type: 'add', ln: 41, text: '  const schema = z.object({' },
        { type: 'add', ln: 42, text: '    deliveryMode: z.enum(["auto-merge", "pr", "branch"]),' },
        { type: 'add', ln: 43, text: '    budgetUsd: z.number().positive(),' },
        { type: 'add', ln: 44, text: '  });' },
        { type: 'ctx', ln: 45, text: '  // …' },
        { type: 'add', ln: 60, text: '  return <form onSubmit={onSave}>…</form>;' },
        { type: 'ctx', ln: 61, text: '}' },
      ],
    },
    {
      file: 'src/pages/Settings.test.tsx',
      plus: 48,
      minus: 0,
      lines: [
        { type: 'add', ln: 1, text: "it('rejects empty deliveryMode', () => {" },
        { type: 'add', ln: 2, text: '  expect(validate({})).toMatchObject({ ok: false });' },
        { type: 'add', ln: 3, text: '});' },
      ],
    },
  ];
}

function sampleDiffHotkeys() {
  return [
    {
      file: 'src/hooks/useAcceptHotkeys.ts',
      plus: 36,
      minus: 2,
      lines: [
        { type: 'add', ln: 1, text: "case 'a': passCurrent(); break;" },
        { type: 'add', ln: 2, text: "case 'r': rejectCurrent(); break;" },
        { type: 'add', ln: 3, text: "case 'j': selectNext(1); break;" },
        { type: 'add', ln: 4, text: "case 'k': selectNext(-1); break;" },
      ],
    },
    {
      file: 'src/views/Accept.tsx',
      plus: 22,
      minus: 4,
      lines: [
        { type: 'add', ln: 88, text: '<div className="hotkey-hint">j/k · a · r · t</div>' },
        { type: 'ctx', ln: 89, text: '// reviewer: 提示位置需人工判断是否挡 diff' },
      ],
    },
  ];
}
