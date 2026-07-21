/* Koda 活原型 v0.4 — 视图渲染 */
import {
  COLUMNS,
  STATE_COLUMN,
  STATE_LABEL,
  OVERLAY_LABEL,
  PLANNER_STREAM_LINES,
} from './data.js';

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ---------- 图标 ---------- */
const I = {
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.2 3.9A2 2 0 0 0 7.5 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
  board: '<rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="11" rx="1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  spark: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  branch: '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18M7 6h1v4M16.71 13.88l.7.71-2.82 2.82"/>',
  robot: '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4M8 2h8M9 14h.01M15 14h.01"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/>',
  expand: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  retry: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
};

export function icon(name, size = 14, cls = '') {
  return `<svg class="svg-ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[name] || ''}</svg>`;
}

/* ---------- 侧栏 ---------- */
export function renderSidebar(state) {
  const unread = state.inbox.filter((i) => i.unread && !i.done).length;
  const projectRows = state.projects
    .map((p) => {
      const cards = state.cards.filter((c) => c.projectId === p.id);
      const running = cards.filter((c) =>
        ['READY', 'RUNNING', 'FIXING', 'REVIEWING'].includes(c.state)
      ).length;
      const awaiting = cards.filter((c) => c.state === 'AWAITING_ACCEPTANCE').length;
      const active = p.id === state.activeProjectId;
      const badges = [
        running ? `<span class="nav-badge">${icon('robot', 9)} ${running}</span>` : '',
        awaiting ? `<span class="nav-badge await">${awaiting}</span>` : '',
      ].join('');
      return `<button class="nav-item ${active ? 'active' : ''}" data-act="project" data-id="${p.id}" title="${esc(p.desc)}">
        <span class="nav-ico">${icon('folder', 14)}</span>
        <span>${esc(p.name)}</span>
        ${badges}
      </button>`;
    })
    .join('');

  const settingsActive = state.tabs.some(
    (t) => t.id === state.activeTabId && t.kind === 'settings'
  );

  return `
    <div class="brand">
      <div class="brand-badge">K</div>
      <div>
        <div class="brand-name">KODA</div>
        <div class="brand-sub">local ai dev factory</div>
      </div>
    </div>
    <button class="nav-item ${state.inboxOpen ? 'active' : ''}" data-act="inbox">
      <span class="nav-ico" id="bellIco">${icon('bell', 15)}</span>
      <span>收件箱</span>
      ${unread ? `<span class="nav-badge hot">${unread}</span>` : ''}
    </button>
    <div class="side-divider"></div>
    <div class="side-label">项目</div>
    ${projectRows}
    <button class="nav-item" data-act="add-project">
      <span class="nav-ico">${icon('plus', 14)}</span><span>添加项目</span>
    </button>
    <div class="side-spacer"></div>
    <div class="side-divider"></div>
    <button class="nav-item ${settingsActive ? 'active' : ''}" data-act="settings">
      <span class="nav-ico">${icon('gear', 15)}</span><span>设置</span>
    </button>
  `;
}

/* ---------- 标签栏 ---------- */
export function renderTabbar(state) {
  const awaitingCount = state.cards.filter(
    (c) => c.projectId === state.activeProjectId && c.state === 'AWAITING_ACCEPTANCE'
  ).length;
  return state.tabs
    .map((t) => {
      const active = t.id === state.activeTabId;
      let countHtml = '';
      if (t.kind === 'accept') {
        countHtml = `<span class="tab-count ${awaitingCount ? '' : 'zero'}">${awaitingCount}</span>`;
      }
      const icoName =
        t.kind === 'board' ? 'board' : t.kind === 'accept' ? 'check' : t.kind === 'takeover' ? 'chat' : 'gear';
      return `<button class="tab ${active ? 'active' : ''}" data-act="tab" data-id="${t.id}" role="tab" aria-selected="${active}">
        <span class="tab-ico">${icon(icoName, 13)}</span>
        ${esc(t.title)}
        ${countHtml}
        ${t.closable ? `<span class="tab-close" data-act="tab-close" data-id="${t.id}" title="关闭标签">${icon('x', 10)}</span>` : ''}
      </button>`;
    })
    .join('');
}

/* ---------- 状态栏 ---------- */
export function renderStatusbar(state) {
  const p = state.projects.find((x) => x.id === state.activeProjectId);
  const cards = state.cards.filter((c) => c.projectId === state.activeProjectId);
  const worktrees = cards.filter((c) => c.worktree).length;
  const addDel = cards.reduce(
    (acc, c) => {
      (c.files || []).forEach((f) => {
        acc.add += f.add || 0;
        acc.del += f.del || 0;
      });
      return acc;
    },
    { add: 562, del: 104 }
  );
  const slotsUsed = cards.filter(
    (c) =>
      ['READY', 'RUNNING', 'FIXING'].includes(c.state) &&
      !c.overlays.some((o) => ['PAUSED', 'HELP', 'FAILED', 'TAKEN_OVER'].includes(o))
  ).length;
  const slotDots = Array.from({ length: state.settings.slots })
    .map((_, i) => `<span class="slot ${i < slotsUsed ? 'on' : ''}"></span>`)
    .join('');
  const providerDown = false;
  return `
    <span class="sb-item">${icon('branch', 11)} <b>${esc(p ? p.branch : 'main')}</b></span>
    <span class="sb-item">${worktrees} worktrees</span>
    <span class="sb-item"><b style="color:var(--st-done)">+${addDel.add}</b>/<b style="color:var(--st-fail)">−${addDel.del}</b></span>
    <span class="sb-item"><span class="sb-dot ${providerDown ? 'warn' : ''}"></span> claude-sonnet ${providerDown ? '✗' : '✓'}</span>
    <span class="sb-item sb-slots">槽位 ${slotDots} ${slotsUsed}/${state.settings.slots}</span>
    <span class="sb-spacer"></span>
    <span class="sb-item">${icon('clock', 11)} 无人值守 <b>2h 41m</b></span>
    <span class="sb-item">今日 <span class="sb-cost">$${state.stats.todayCost.toFixed(2)}</span></span>
  `;
}

/* ---------- 看板 ---------- */
function overlayBadges(card) {
  return card.overlays
    .map((o) => {
      const ico = o === 'HELP' ? 'alert' : o === 'FAILED' ? 'x' : o === 'PAUSED' ? 'pause' : 'hand';
      return `<span class="overlay-badge ${o}">${icon(ico, 9)} ${OVERLAY_LABEL[o]}</span>`;
    })
    .join('');
}

function cardView(card, draggable) {
  const live = ['RUNNING', 'FIXING', 'REVIEWING'].includes(card.state);
  const depChips = card.dependsOn
    .map((d) => `<span class="chip dep">🔗 ${esc(d.replace('c-', ''))}</span>`)
    .join('');
  const prio =
    card.priority === 'high' ? '<span class="chip prio-high">▲ 高</span>' : '';
  const done = card.state === 'DONE';
  return `<div class="card st-${card.state} ${card.fresh ? 'fresh' : ''}"
      data-act="card" data-id="${card.id}" data-card-id="${card.id}"
      ${draggable ? `draggable="true"` : ''} tabindex="0" role="button"
      aria-label="${esc(card.title)} · ${STATE_LABEL[card.state]}">
    <div class="card-title">${esc(card.title)}</div>
    ${card.liveTail ? `<div class="card-tail ${live ? 'live' : ''}" data-tail="${card.id}">${esc(card.liveTail)}</div>` : ''}
    <div class="card-meta">
      ${done ? `<span class="chip state-chip" style="color:var(--st-done);background:var(--st-done-soft)">✓ ${STATE_LABEL[card.state]}</span>` : `<span class="chip state-chip ${card.state}">${STATE_LABEL[card.state]}</span>`}
      ${overlayBadges(card)}
      ${prio}${depChips}
      <span class="chip cost" data-cost="${card.id}">$${card.cost.toFixed(2)}</span>
    </div>
  </div>`;
}

function splitPanel(state) {
  const sp = state.split;
  if (!sp) return '';
  const stream = PLANNER_STREAM_LINES.slice(0, sp.lineIdx)
    .map((l) => `<div>${esc(l)}</div>`)
    .join('');
  const cursor = sp.phase === 'streaming' ? '<span class="cur"></span>' : '';
  const drafts =
    sp.phase === 'preview'
      ? `<div class="split-cards">${sp.drafts
          .map(
            (d, i) => `
        <div class="split-card ${d.warn ? 'warn' : ''}" style="animation-delay:${i * 90}ms">
          <button class="sc-del" data-act="split-del" data-id="${d.id}" title="删除此卡">${icon('x', 10)}</button>
          <div class="sc-num">CARD ${i + 1}</div>
          <input class="sc-title" data-act="split-title" data-id="${d.id}" value="${esc(d.title)}" />
          <div class="sc-meta">
            <span>验收标准 ${d.criteria.length} 条 ${d.warn ? '' : '· 可机器验证'}</span>
            ${d.dependsOn ? `<span class="sc-dep">↳ 依赖: ${esc(sp.drafts.find((x) => x.id === d.dependsOn)?.title || d.dependsOn)}</span>` : '<span>独立任务（可并行）</span>'}
            ${d.warn ? '<span class="sc-warn">⚠ 验收标准偏主观，reviewer 将标「需人工判断」</span>' : ''}
            <span>预估涉及 ${d.files} 个文件</span>
          </div>
        </div>`
          )
          .join('')}</div>
      <div class="split-foot">
        <span class="hint">标题可直接编辑 · 依赖连线已按变更关系推断</span>
        <button class="btn btn-ghost" data-act="split-cancel">取消</button>
        <button class="btn btn-primary" data-act="split-enter">${icon('play', 11)} 全部入场</button>
      </div>`
      : '';
  return `<div class="split-panel">
    <div class="split-head">
      <span class="tag">PLANNER</span>
      ${sp.phase === 'streaming' ? '正在拆卡…' : `拆出 ${sp.drafts.length} 张卡（可编辑）`}
      <span class="sp-spacer"></span>
      <span class="muted mono" style="font-size:10px">${icon('zap', 10)} 只读扫描，不改代码</span>
    </div>
    <div class="split-stream">${stream}${cursor}</div>
    ${drafts}
  </div>`;
}

export function renderBoard(state) {
  const cards = state.cards.filter((c) => c.projectId === state.activeProjectId);
  const awaiting = cards.filter((c) => c.state === 'AWAITING_ACCEPTANCE').length;

  const cols = COLUMNS.map((col) => {
    const colCards = cards
      .filter((c) => STATE_COLUMN[c.state] === col.id)
      .sort((a, b) => a.manualOrder - b.manualOrder);
    const draggable = col.id === 'BACKLOG';
    const body = colCards.length
      ? colCards.map((c) => cardView(c, draggable)).join('')
      : `<div class="col-empty">${col.id === 'DONE' ? '还没有完成的卡' : '空'}</div>`;
    const headExtra = col.human
      ? `<button class="col-accept-btn ${awaiting ? 'pulse' : ''}" data-act="accept" ${!awaiting ? 'disabled style="opacity:.45"' : ''}>进入验收台${awaiting ? ` ${awaiting}` : ''}</button>`
      : col.hint
        ? `<span class="col-hint">${col.hint}</span>`
        : col.bot
          ? `<span class="col-hint">${icon('robot', 10)} 自动</span>`
          : '';
    return `<section class="col" data-col="${col.id}">
      <header class="col-head">
        <span class="col-dot" style="background:${col.dot}"></span>
        <span class="col-name">${col.name}</span>
        <span class="col-count">${colCards.length}</span>
        ${headExtra}
      </header>
      <div class="col-body" data-col-body="${col.id}">${body}</div>
    </section>`;
  }).join('');

  const demoActive = state.demo.active;
  return `<div class="board">
    <div class="intake">
      <div class="intake-row">
        <div class="intake-input-wrap">
          <span class="spark">${icon('spark', 15)}</span>
          <input id="intakeInput" class="intake-input" placeholder="描述一个需求，Planner 帮你拆卡…（↵ 拆卡 · ⌘↵ 快速建卡）" value="${esc(state.intakeDraft || '')}" data-act="intake-typing" />
          <span class="intake-hints"><span class="kbd">↵</span><span class="kbd">⌘↵</span></span>
        </div>
        <button class="demo-btn" data-act="demo" ${demoActive ? 'disabled' : ''}>
          ${icon('play', 12)} ${demoActive ? '演示中…' : '60 秒演示'}
        </button>
      </div>
      ${splitPanel(state)}
    </div>
    <div class="board-cols">${cols}</div>
  </div>`;
}

/* ---------- 卡片详情抽屉 ---------- */
function critList(criteria, interactive) {
  return `<div class="criteria">${criteria
    .map(
      (c) => `<div class="crit-item">
      <span class="crit-ico ${c.status}">${c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : c.status === 'human' ? '👤' : '·'}</span>
      <div class="crit-body">
        <div>${esc(c.text)}</div>
        ${c.evidence ? `<div class="crit-evidence">证据: <a href="#" data-act="noop">${esc(c.evidence)}</a></div>` : ''}
      </div>
    </div>`
    )
    .join('')}</div>`;
}

function diffFiles(files, diffs) {
  const tree = `<div class="file-tree">${(files || [])
    .map(
      (f) => `<div class="file-row"><span class="file-flag ${f.flag}">${f.flag}</span>${esc(f.path)}<span class="file-stat"><span class="add">+${f.add}</span> <span class="del">−${f.del}</span></span></div>`
    )
    .join('')}</div>`;
  const diffHtml = (diffs || [])
    .map(
      (d) => `<div class="diff-file">
      <div class="diff-file-head"><span class="file-flag ${d.flag}">${d.flag}</span>${esc(d.path)}<span class="stat"><span class="add">+${d.add}</span> <span class="del">−${d.del}</span></span></div>
      <div class="diff-lines">${d.lines
        .map(
          (l) => `<div class="diff-line ${l.type}"><span class="sign">${l.type === 'a' ? '+' : l.type === 'd' ? '−' : l.type === 'h' ? '' : ''}</span><span class="ln">${l.lineNumber ?? ''}</span><span class="code">${esc(l.code)}</span></div>`
        )
        .join('')}</div>
    </div>`
    )
    .join('');
  return tree + diffHtml;
}

export function renderDrawer(state) {
  const host = document.getElementById('drawerHost');
  const d = state.drawer;
  if (!d.open || !d.cardId) {
    host.innerHTML = '<div class="drawer-backdrop"></div><div class="drawer"></div>';
    return;
  }
  const card = state.cards.find((c) => c.id === d.cardId);
  if (!card) {
    host.innerHTML = '';
    return;
  }
  const tabs = [
    ['overview', '概览'],
    ['criteria', '验收标准'],
    ['activity', '活动流'],
    ['changes', '变更'],
    ['history', '历史'],
  ];
  const tabHtml = tabs
    .map(
      ([id, name]) =>
        `<button class="drawer-tab ${d.tab === id ? 'active' : ''}" data-act="drawer-tab" data-tab="${id}">${name}</button>`
    )
    .join('');

  let body = '';
  if (d.tab === 'overview') {
    const deps = card.dependsOn.length
      ? card.dependsOn
          .map((id) => state.cards.find((c) => c.id === id)?.title || id)
          .join('；')
      : '无';
    body = `
      <div class="d-section"><h4>目标</h4><p class="d-goal">${esc(card.goal || '—')}</p></div>
      <div class="d-section"><h4>状态</h4>
        <dl class="d-kv">
          <dt>当前状态</dt><dd>${STATE_LABEL[card.state]}${card.overlays.length ? ' · ' + card.overlays.map((o) => OVERLAY_LABEL[o]).join('/') : ''}</dd>
          <dt>所在列</dt><dd>${STATE_COLUMN[card.state]}</dd>
          <dt>优先级</dt><dd>${card.priority}</dd>
          <dt>依赖</dt><dd>${esc(deps)}</dd>
          <dt>Worktree</dt><dd>${esc(card.worktree || '—（合并后清理）')}</dd>
          <dt>成本</dt><dd>$${card.cost.toFixed(2)} / $${card.budget.toFixed(2)}</dd>
          <dt>Token</dt><dd>${card.tokens.toLocaleString()}</dd>
          <dt>Run 数</dt><dd>${card.runs.length}</dd>
          <dt>打回次数</dt><dd>${card.rejects}（≥3 强制求助）</dd>
        </dl>
      </div>
      ${card.helpQuestion ? `<div class="d-section"><h4>求助中</h4><div class="crit-item" style="border-color:rgba(255,112,136,.4)"><span class="crit-ico human">🆘</span><div class="crit-body">${esc(card.helpQuestion.text).replace(/\n/g, '<br>')}</div></div></div>` : ''}`;
  } else if (d.tab === 'criteria') {
    body = `<div class="d-section"><h4>验收标准（AI 审查结果）</h4>${card.criteria.length ? critList(card.criteria) : '<p class="muted">暂无验收标准</p>'}</div>`;
  } else if (d.tab === 'activity') {
    const items = card.activity
      .map(
        (a) => `<div class="act-item ${a.help ? 'help-card' : ''}">
        <span class="act-dot ${a.who}">${a.who === 'dev' ? '⚡' : a.who === 'review' ? '🔍' : a.who === 'user' ? '👤' : '·'}</span>
        <div class="act-body">
          <div class="act-who">${esc(a.at)} · ${a.who === 'system' ? '系统' : a.who === 'dev' ? 'developer' : a.who === 'review' ? 'reviewer' : a.who === 'agent' ? 'agent' : '你'}</div>
          <div class="act-text">${esc(a.text).replace(/\n/g, '<br>')}</div>
          ${a.help && card.overlays.includes('HELP') ? `<div class="help-reply"><input id="helpReplyInput" placeholder="回一句话，注入原 Run…（如：走方案 A）" /><button class="btn btn-secondary" data-act="help-reply" data-id="${card.id}">回复</button></div>` : ''}
        </div>
      </div>`
      )
      .join('');
    body = `<div class="activity">${items || '<p class="muted">暂无活动</p>'}</div>`;
  } else if (d.tab === 'changes') {
    body = diffFiles(card.files, card.diff);
    if (!card.files?.length) body = '<p class="muted">暂无变更</p>';
  } else if (d.tab === 'history') {
    body = (card.runs.length ? card.runs : [])
      .map(
        (r) => `<div class="run-row">
        <span class="run-kind ${r.kind}">${r.kind.toUpperCase()}</span>
        <span class="run-model">${esc(r.model)}</span>
        <span class="run-cost">$${(r.cost || 0).toFixed(2)} · ${(r.tokens || 0).toLocaleString()} tok</span>
        <span class="run-state ${r.state === 'ok' ? 'ok' : r.state === 'bad' ? 'bad' : 'going'}">${r.state === 'ok' ? '✓ 完成' : r.state === 'bad' ? '✗ 异常' : '● 进行中'}</span>
      </div>`
      )
      .join('') || '<p class="muted">还没有 Run</p>';
  }

  const takenOver = card.overlays.includes('TAKEN_OVER');
  host.innerHTML = `
    <div class="drawer-backdrop ${d.open ? 'open' : ''}" data-act="drawer-close"></div>
    <div class="drawer ${d.open ? 'open' : ''} ${d.full ? 'full' : ''}" role="dialog" aria-label="${esc(card.title)}">
      <div class="drawer-head">
        <div class="drawer-top">
          <h2 class="drawer-title">${esc(card.title)}</h2>
          <button class="btn btn-ghost" data-act="drawer-close" title="关闭 (Esc)">${icon('x', 14)}</button>
        </div>
        <div class="drawer-state">
          <span class="chip state-chip ${card.state}">${STATE_LABEL[card.state]}</span>
          ${overlayBadges(card)}
          <span>${esc(card.id)} · ${esc(card.worktree || '无 worktree')}</span>
        </div>
        <div class="drawer-actions">
          <button class="btn btn-secondary" data-act="takeover" data-id="${card.id}">${icon('hand', 12)} 接管 <span class="kbd">t</span></button>
          <button class="btn btn-secondary" data-act="card-pause" data-id="${card.id}" ${takenOver ? 'disabled' : ''}>${icon('pause', 12)} 暂停</button>
          <button class="btn btn-danger" data-act="card-cancel" data-id="${card.id}">${icon('x', 12)} 取消卡片</button>
          <button class="btn btn-ghost" data-act="drawer-full" style="margin-left:auto">${icon('expand', 13)} ${d.full ? '还原' : '全屏'}</button>
        </div>
      </div>
      <div class="drawer-tabs">${tabHtml}</div>
      <div class="drawer-body">${body}</div>
    </div>`;
}

/* ---------- 验收台 ---------- */
export function renderAccept(state) {
  const cards = state.cards.filter(
    (c) => c.projectId === state.activeProjectId && c.state === 'AWAITING_ACCEPTANCE'
  );
  if (!cards.length) {
    return `<div class="accept-empty">
      <div>
        <div class="big">🎉</div>
        <div style="font-size:14px;font-weight:600;margin-bottom:6px">队列清空</div>
        <div style="font-size:12px">没有待验收的卡了——回去看机器人们干活吧。</div>
        <button class="btn btn-secondary" data-act="tab" data-id="board" style="margin-top:16px">返回看板</button>
      </div>
    </div>`;
  }
  let selected = cards.find((c) => c.id === state.acceptSelectedId) || cards[0];
  const idx = cards.indexOf(selected);

  const queue = cards
    .map(
      (c, i) => `<button class="aq-item ${c.id === selected.id ? 'selected' : ''}" data-act="accept-select" data-id="${c.id}">
      <div class="aq-title">${i + 1}. ${esc(c.title)}</div>
      <div class="aq-meta"><span class="add">+${c.files?.reduce((s, f) => s + f.add, 0) || 0}</span><span class="del">−${c.files?.reduce((s, f) => s + f.del, 0) || 0}</span><span>$${c.cost.toFixed(2)}</span><span>${c.rejects ? '打回' + c.rejects + '次' : '一次过'}</span></div>
    </button>`
    )
    .join('');

  const criteriaHtml = critList(selected.criteria);
  const passCount = selected.criteria.filter((c) => c.status === 'pass').length;
  const humanCount = selected.criteria.filter((c) => c.status === 'human').length;
  const rejectBox = state.rejectOpen
    ? `<div class="reject-box">
        <textarea id="rejectComment" placeholder="写一句打回评语，会注入新的 FIXING Run…"></textarea>
        <div class="rb-actions">
          <button class="btn btn-ghost" data-act="reject-cancel">取消</button>
          <button class="btn btn-danger" data-act="reject-confirm" data-id="${selected.id}">↩ 确认打回</button>
        </div>
      </div>`
    : '';

  return `<div class="accept">
    <div class="accept-queue">
      <div class="accept-queue-head">待验收队列 <span class="count">${cards.length}</span></div>
      <div class="accept-queue-body">${queue}</div>
      <div class="accept-queue-foot">
        <span><span class="kbd">j</span><span class="kbd">k</span> 切换</span>
        <span><span class="kbd">a</span> 通过</span>
        <span><span class="kbd">r</span> 打回</span>
        <span><span class="kbd">t</span> 接管</span>
      </div>
    </div>
    <div class="accept-diff">
      <div class="diff-head">
        <span class="diff-head-title">${esc(selected.title)}</span>
        <span class="mono" style="font-size:10px;color:var(--tx3)">${idx + 1}/${cards.length} · ${esc(selected.worktree || '')}</span>
      </div>
      <div class="diff-body">${diffFiles(selected.files, selected.diff)}</div>
    </div>
    <div class="accept-side">
      <div class="accept-side-head">
        <h3>验收清单</h3>
        <div class="verdict">${icon('check', 12)} AI 审查: 通过（${passCount}/${selected.criteria.length} 机器验证${humanCount ? '，' + humanCount + ' 项需人看' : ''}）<a href="#" data-act="noop" class="mono" style="color:var(--st-dev);text-decoration:none">📄 报告</a></div>
      </div>
      <div class="accept-side-body">${criteriaHtml}</div>
      <div class="accept-actions">
        <button class="btn btn-pass" data-act="accept-pass" data-id="${selected.id}">✓ 通过 <span class="kbd">a</span></button>
        <button class="btn btn-danger" data-act="accept-reject" data-id="${selected.id}">↩ 打回 <span class="kbd">r</span></button>
        ${rejectBox}
        <button class="btn btn-secondary wide" data-act="takeover" data-id="${selected.id}">${icon('hand', 12)} 接管会话 <span class="kbd">t</span></button>
      </div>
    </div>
  </div>`;
}

/* ---------- 接管会话 ---------- */
export function renderTakeover(state, tab) {
  const card = state.cards.find((c) => c.id === tab.cardId);
  if (!card) return '<div class="accept-empty">卡片不存在</div>';
  const msgs = (card.takeoverMessages || [])
    .map((m) =>
      m.tool
        ? `<div class="tk-tool">⚙ ${esc(m.tool)} <span class="ok">✓</span></div>`
        : `<div class="tk-msg ${m.who}">
          <div class="tk-msg-who">${m.who === 'agent' ? 'AGENT · claude-sonnet' : '你'}</div>
          <div class="tk-bubble">${esc(m.text).replace(/\n/g, '<br>')}</div>
        </div>`
    )
    .join('');
  return `<div class="takeover">
    <div class="tk-main">
      <div class="tk-head">
        <span class="tk-flag">TAKEN_OVER</span>
        <span class="title">${esc(card.title)}</span>
        <span class="muted" style="font-size:11px">自动调度已暂停 · 槽位已释放</span>
        <span class="sp"></span>
        <button class="btn btn-primary" data-act="takeover-return" data-id="${card.id}">交还自动流</button>
      </div>
      <div class="tk-stream" id="tkStream">${msgs}</div>
      <div class="tk-input-row">
        <input id="tkInput" class="tk-input" placeholder="输入指令，直接指挥这张卡…（Enter 发送）" data-id="${card.id}" />
        <button class="btn btn-secondary" data-act="tk-send" data-id="${card.id}">${icon('send', 13)}</button>
      </div>
      <div class="tk-note">Esc 不会交还——交还前不会产生新的自动 Run。</div>
    </div>
    <div class="tk-workbench">
      <div class="tk-wb-head">${icon('file', 12)} Workbench · 实时 Diff</div>
      <div class="tk-wb-body">${diffFiles(card.files, card.diff)}</div>
    </div>
  </div>`;
}

/* ---------- 收件箱 ---------- */
const INBOX_TYPE_LABEL = {
  AWAITING_ACCEPTANCE: '待验收',
  HELP: '求助',
  FAILED: '失败',
  BUDGET: '成本超限',
};
const INBOX_ICO = {
  AWAITING_ACCEPTANCE: 'check',
  HELP: 'alert',
  FAILED: 'x',
  BUDGET: 'pause',
};

export function renderInbox(state) {
  if (!state.inboxOpen) {
    document.getElementById('inboxHost').innerHTML = '';
    return;
  }
  const pending = state.inbox.filter((i) => !i.done);
  const done = state.inbox.filter((i) => i.done);
  const item = (i) => {
    const proj = state.projects.find((p) => p.id === i.projectId);
    return `<button class="inbox-item ${i.unread ? 'unread' : ''} ${i.isNew ? 'new-flash' : ''}" data-act="inbox-item" data-id="${i.id}">
      <span class="ib-ico ${i.type}">${icon(INBOX_ICO[i.type], 12)}</span>
      <div class="ib-body">
        <div class="ib-title">${esc(i.title)}</div>
        <div class="ib-sub"><span class="ib-type ${i.type}">${INBOX_TYPE_LABEL[i.type]}</span><span>${esc(proj?.name || i.projectId)}</span></div>
      </div>
      <span class="ib-time">${esc(i.time)}</span>
      ${i.unread ? '<span class="ib-dot"></span>' : ''}
    </button>`;
  };
  document.getElementById('inboxHost').innerHTML = `
    <div class="inbox-panel" role="dialog" aria-label="收件箱">
      <div class="inbox-head">${icon('inbox', 15)} 收件箱 <span class="muted" style="font-size:11px;font-weight:400">跨项目聚合 · 只有四类会打扰你</span>
        <span class="sp"></span>
        <button class="btn btn-ghost" data-act="inbox-read-all" style="height:26px;padding:0 9px;font-size:11px">全部已读</button>
        <button class="btn btn-ghost" data-act="inbox-close" style="height:26px;padding:0 7px">${icon('x', 13)}</button>
      </div>
      <div class="inbox-body">
        <div class="inbox-section">待处理 (${pending.length})</div>
        ${pending.map(item).join('') || '<div class="inbox-empty">收件箱空空如也 🎉</div>'}
        ${done.length ? `<div class="inbox-section">已处理 (${done.length})</div>${done.map(item).join('')}` : ''}
      </div>
    </div>`;
}

/* ---------- 设置 ---------- */
export function renderSettings(state) {
  const s = state.settings;
  const sections = [
    ['general', '通用', 'gear'],
    ['project', '项目', 'folder'],
    ['team', '团队', 'robot'],
    ['provider', '模型与 Provider', 'zap'],
    ['budget', '预算', 'coins'],
    ['stats', '统计', 'clock'],
  ];
  const rail = sections
    .map(
      ([id, name, ico]) =>
        `<button class="set-rail-item ${s.section === id ? 'active' : ''}" data-act="set-section" data-id="${id}">${icon(ico, 14)} ${name}</button>`
    )
    .join('');

  let content = '';
  if (s.section === 'general') {
    content = `
      <h2>通用</h2><p class="set-sub">调度与守护参数。改了立即生效。</p>
      <div class="set-group">
        <div class="set-row">
          <div class="set-row-label"><div class="t">全局并发槽位</div><div class="d">同时运行的 develop/fix 类 Run 上限。review 与 plan 不占槽。</div></div>
          <div class="stepper"><button data-act="slots-dec">−</button><span class="val">${s.slots}</span><button data-act="slots-inc">＋</button></div>
        </div>
        <div class="set-row">
          <div class="set-row-label"><div class="t">Watchdog 超时</div><div class="d">agent 无工具调用超过该时长 → FAILED（不自动重跑）。</div></div>
          <div class="seg">${[15, 30, 60].map((v) => `<button data-act="watchdog" data-v="${v}" class="${s.watchdog === v ? 'active' : ''}">${v}min</button>`).join('')}</div>
        </div>
        <div class="set-row">
          <div class="set-row-label"><div class="t">桌面通知</div><div class="d">v1 唯一触达通道。仅四类事件：待验收 / 求助 / 失败 / 成本超限。</div></div>
          <button class="btn ${s.notify ? 'btn-pass' : 'btn-secondary'}" data-act="notify-toggle">${s.notify ? '✓ 开' : '关'}</button>
        </div>
      </div>`;
  } else if (s.section === 'project') {
    const p = state.projects.find((x) => x.id === state.activeProjectId);
    content = `
      <h2>项目 · ${esc(p?.name || '')}</h2><p class="set-sub">v1 一看板一仓库，模型已预留 repoIds[]。</p>
      <div class="set-group">
        <div class="set-row">
          <div class="set-row-label"><div class="t">仓库路径</div><div class="d">卡片 worktree 从这里切出，验收后合并回来。</div></div>
          <span class="mono" style="font-size:11px;color:var(--tx2)">~/Desktop/my/${esc(p?.id || 'koda')}</span>
        </div>
        <div class="set-row">
          <div class="set-row-label"><div class="t">交付方式 deliveryMode</div><div class="d">验收通过后的合并策略。</div></div>
          <div class="seg">${[['auto-merge', 'auto-merge'], ['pr', 'pr'], ['branch', 'branch']].map(([v, l]) => `<button data-act="delivery" data-v="${v}" class="${s.deliveryMode === v ? 'active' : ''}">${l}</button>`).join('')}</div>
        </div>
        <div class="set-row">
          <div class="set-row-label"><div class="t">合并冲突处理</div><div class="d">系统内置 rebase 任务自动尝试一次（非 specialist，不占槽）；失败才升级 HELP。</div></div>
          <span class="mono" style="font-size:11px;color:var(--st-done)">自动 ✓</span>
        </div>
      </div>`;
  } else if (s.section === 'team') {
    content = `
      <h2>团队</h2><p class="set-sub">specialist = agent 角色定义。systemPrompt / 工具 / 模型 / Skills 均可配。</p>
      <div class="set-group">
        <div class="team-row">
          <span class="team-name"><span class="team-ava planner">P</span>planner</span>
          <div class="team-detail">model: <b>claude-sonnet</b> · 权限: 只读扫描 + 建卡<br>职责: 把一句需求拆成带验收标准的卡片组</div>
          <button class="btn btn-ghost" data-act="noop">编辑</button>
        </div>
        <div class="team-row">
          <span class="team-name"><span class="team-ava developer">D</span>developer</span>
          <div class="team-detail">model: <b>claude-sonnet</b> · 权限: worktree 内全权<br>职责: 在 per-card worktree 开发，拿不准就升级求助</div>
          <button class="btn btn-ghost" data-act="noop">编辑</button>
        </div>
        <div class="team-row">
          <span class="team-name"><span class="team-ava reviewer">R</span>reviewer</span>
          <div class="team-detail">model: <b>claude-opus</b> · 权限: 只读 + 跑测试<br>职责: 对照验收标准逐条核查，产出带证据的结构化报告</div>
          <button class="btn btn-ghost" data-act="noop">编辑</button>
        </div>
      </div>
      <button class="btn btn-secondary">${icon('plus', 13)} 自定义 specialist</button>`;
  } else if (s.section === 'provider') {
    content = `
      <h2>模型与 Provider</h2><p class="set-sub">Anthropic 兼容 API，可换第三方端点。</p>
      <div class="set-group">
        <div class="set-row"><div class="set-row-label"><div class="t">API Key</div><div class="d">存本地 SQLite，不出机器。</div></div><span class="mono" style="font-size:11px">sk-••••••••3f2a</span></div>
        <div class="set-row"><div class="set-row-label"><div class="t">Base URL</div><div class="d">默认官方端点。</div></div><span class="mono" style="font-size:11px">https://api.anthropic.com</span></div>
        <div class="set-row"><div class="set-row-label"><div class="t">健康检查</div><div class="d">状态栏红点即来自这里。</div></div><span class="mono" style="font-size:11px;color:var(--st-done)">✓ 可达 · 213ms</span></div>
      </div>`;
  } else if (s.section === 'budget') {
    content = `
      <h2>预算</h2><p class="set-sub">护栏：防止工厂烧钱包。</p>
      <div class="set-group">
        <div class="set-row"><div class="set-row-label"><div class="t">全局日限额</div><div class="d">触顶后所有卡暂停出队。</div></div><div class="stepper"><button data-act="cap-dec">−</button><span class="val">$${s.dailyCap}</span><button data-act="cap-inc">＋</button></div></div>
        <div class="set-row"><div class="set-row-label"><div class="t">单卡默认预算</div><div class="d">超限 → PAUSED + 收件箱。</div></div><div class="stepper"><button data-act="budget-dec">−</button><span class="val">$${s.defaultBudget.toFixed(0)}</span><button data-act="budget-inc">＋</button></div></div>
        <div class="set-row"><div class="set-row-label"><div class="t">超限动作</div><div class="d">v1 只有暂停，不做自动取消。</div></div><span class="mono" style="font-size:11px">PAUSED</span></div>
      </div>`;
  } else if (s.section === 'stats') {
    const st = state.stats;
    content = `
      <h2>统计 · 北极星五项</h2><p class="set-sub">数据全量采集；v1 不做独立报表页。</p>
      <div class="stat-grid">
        <div class="stat-card hero">
          <div class="stat-label">人均介入时间 / 卡（北极星）</div>
          <div class="stat-value">3.8<small>min</small></div>
          <div class="stat-target">目标 &lt; 5min · 拆卡 + 验收 + 求助</div>
          <div class="stat-bar"><i style="width:76%"></i></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">首次验收通过率</div>
          <div class="stat-value">74<small>%</small></div>
          <div class="stat-target">目标 ≥ 70%</div>
          <div class="stat-bar"><i style="width:74%"></i></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">无人值守跨度</div>
          <div class="stat-value">2.7<small>h</small></div>
          <div class="stat-target">目标 ≥ 2h · 相邻人操作最大间隔</div>
          <div class="stat-bar"><i style="width:88%"></i></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">自动打回收敛轮次</div>
          <div class="stat-value">0.8<small>轮</small></div>
          <div class="stat-target">目标中位数 ≤ 1</div>
          <div class="stat-bar"><i style="width:80%"></i></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">本周成本</div>
          <div class="stat-value">$${(st.todayCost * 3.4).toFixed(2)}</div>
          <div class="stat-target">预算护栏触发率 8% · 周交付 ${st.weekCards} 卡</div>
          <div class="stat-bar"><i class="warn" style="width:34%"></i></div>
        </div>
      </div>`;
  }

  return `<div class="settings"><nav class="set-rail">${rail}</nav><div class="set-content">${content}</div></div>`;
}

/* ---------- Toast ---------- */
export function toastHtml(kind, title, sub) {
  const ico = kind === 'success' ? 'check' : kind === 'warn' ? 'alert' : 'bell';
  return `<span class="t-ico">${icon(ico, 14)}</span>
    <div><div class="t-title">${esc(title)}</div>${sub ? `<div class="t-sub">${esc(sub)}</div>` : ''}</div>`;
}
