import { COLUMNS, STATE_LABEL, createInitialState } from './data.js';

const state = createInitialState();
const appEl = document.getElementById('app');

function $(id) {
  return document.getElementById(id);
}

function toast(message) {
  const host = $('toastHost');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function project(id = state.activeProjectId) {
  return state.projects.find((p) => p.id === id);
}

function cardsOf(projectId = state.activeProjectId) {
  return state.cards.filter((c) => c.projectId === projectId);
}

function cardById(id) {
  return state.cards.find((c) => c.id === id);
}

function awaitingCards(projectId = state.activeProjectId) {
  return cardsOf(projectId).filter((c) => c.state === 'AWAITING_ACCEPTANCE');
}

function runningCount(projectId) {
  return cardsOf(projectId).filter((c) =>
    ['READY', 'RUNNING', 'FIXING', 'REVIEWING'].includes(c.state) ||
    c.overlays.includes('TAKEN_OVER')
  ).length;
}

function unreadInbox() {
  return state.inbox.filter((i) => i.unread);
}

function ensureBoardTabTitle() {
  const tab = state.tabs.find((t) => t.kind === 'board');
  if (tab) tab.title = `${project().name} · 看板`;
}

function openTab(tab) {
  const existing = state.tabs.find((t) => t.id === tab.id);
  if (!existing) state.tabs.push(tab);
  state.activeTabId = tab.id;
}

function closeTab(tabId) {
  if (tabId === 'board') return;
  const idx = state.tabs.findIndex((t) => t.id === tabId);
  if (idx < 0) return;
  state.tabs.splice(idx, 1);
  if (state.activeTabId === tabId) {
    state.activeTabId = state.tabs[Math.max(0, idx - 1)]?.id || 'board';
  }
}

function openDrawer(cardId, tab = 'overview') {
  state.drawer = { open: true, cardId, tab };
  render();
}

function closeDrawer() {
  state.drawer.open = false;
  render();
}

function openAcceptance(cardId) {
  const p = project();
  openTab({
    id: `accept-${p.id}`,
    kind: 'accept',
    title: `验收台 (${awaitingCards().length})`,
    closable: true,
    projectId: p.id,
  });
  if (cardId) state.acceptSelectedId = cardId;
  else if (!awaitingCards().some((c) => c.id === state.acceptSelectedId)) {
    state.acceptSelectedId = awaitingCards()[0]?.id || null;
  }
  state.inboxOpen = false;
  state.drawer.open = false;
  render();
}

function openTakeover(cardId) {
  const card = cardById(cardId);
  if (!card) return;
  if (!card.overlays.includes('TAKEN_OVER')) {
    card.overlays = [...new Set([...card.overlays, 'TAKEN_OVER'])];
    card.overlays = card.overlays.filter((o) => o !== 'HELP');
    card.liveTail = '👤 人在环 · 自动调度已暂停';
    card.activity.unshift({
      at: nowLabel(),
      who: 'system',
      text: 'TAKEN_OVER：暂停自动调度并释放槽位',
    });
  }
  if (!card.takeoverMessages) {
    card.takeoverMessages = [
      { who: 'agent', text: `已进入接管模式。当前目标：${card.goal}` },
    ];
  }
  openTab({
    id: `takeover-${card.id}`,
    kind: 'takeover',
    title: `接管 · ${card.title}`,
    closable: true,
    cardId: card.id,
  });
  state.drawer.open = false;
  state.inboxOpen = false;
  render();
}

function returnFromTakeover(cardId) {
  const card = cardById(cardId);
  if (!card) return;
  card.overlays = card.overlays.filter((o) => o !== 'TAKEN_OVER');
  if (!['DONE', 'CANCELLED', 'AWAITING_ACCEPTANCE', 'MERGING'].includes(card.state)) {
    card.state = 'RUNNING';
    card.liveTail = '⚡ 交还后继续自动流';
  }
  card.activity.unshift({
    at: nowLabel(),
    who: 'system',
    text: '交还：清除 TAKEN_OVER，重新入队/续跑',
  });
  closeTab(`takeover-${cardId}`);
  toast(`已交还「${card.title}」`);
  render();
}

function nowLabel() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function passCard(cardId) {
  const card = cardById(cardId);
  if (!card || card.state !== 'AWAITING_ACCEPTANCE') return;
  const mode = project(card.projectId).deliveryMode;
  card.state = 'MERGING';
  card.liveTail = `合并中 · deliveryMode=${mode}`;
  card.activity.unshift({
    at: nowLabel(),
    who: 'human',
    text: `验收通过 → MERGING（${mode}）`,
  });
  render();
  setTimeout(() => {
    card.state = 'DONE';
    card.liveTail =
      mode === 'auto-merge'
        ? '已 squash 合并 main，worktree 已清理'
        : mode === 'pr'
          ? '已建 PR，等待 CI/人工合并'
          : '已推分支，留人处理';
    card.activity.unshift({
      at: nowLabel(),
      who: 'system',
      text: `系统 merge 任务完成 → DONE（${mode}）`,
    });
    state.inbox = state.inbox.filter((i) => !(i.cardId === card.id && i.type === 'AWAITING_ACCEPTANCE'));
    const rest = awaitingCards(card.projectId);
    state.acceptSelectedId = rest[0]?.id || null;
    if (!rest.length) {
      const tabId = `accept-${card.projectId}`;
      if (state.activeTabId === tabId) closeTab(tabId);
      toast('验收队列已清空，回到看板');
    } else {
      toast(`已通过「${card.title}」`);
    }
    render();
  }, 650);
}

function rejectCard(cardId) {
  const card = cardById(cardId);
  if (!card || card.state !== 'AWAITING_ACCEPTANCE') return;
  const note = window.prompt('打回评语（会注入新的 fix Run）', '快捷键提示位置挡 diff，挪到右下角');
  if (note === null) return;
  card.state = 'FIXING';
  card.liveTail = '↩ 按人评语修复中…';
  card.activity.unshift({
    at: nowLabel(),
    who: 'human',
    text: `验收打回：${note || '（无评语）'}`,
  });
  card.runs.push({ id: `fix-${Date.now()}`, kind: 'fix', state: 'running' });
  state.inbox = state.inbox.filter((i) => !(i.cardId === card.id && i.type === 'AWAITING_ACCEPTANCE'));
  const rest = awaitingCards(card.projectId);
  state.acceptSelectedId = rest[0]?.id || null;
  toast(`已打回「${card.title}」`);
  render();
}

function replyHelp(cardId, text) {
  const card = cardById(cardId);
  if (!card || !text.trim()) return;
  card.overlays = card.overlays.filter((o) => o !== 'HELP');
  card.liveTail = '⚡ 收到裁决，继续实现…';
  card.activity.unshift({
    at: nowLabel(),
    who: 'human',
    text: `轻回复：${text.trim()}`,
  });
  card.activity.unshift({
    at: nowLabel(),
    who: 'system',
    text: '回答注入原 Run，清除 HELP',
  });
  state.inbox = state.inbox.filter((i) => !(i.cardId === card.id && i.type === 'HELP'));
  toast('已回复，agent 继续');
  render();
}

function quickCreateCard(title) {
  const id = `card-${Date.now()}`;
  const maxOrder = Math.max(0, ...cardsOf().map((c) => c.manualOrder || 0));
  state.cards.push({
    id,
    projectId: state.activeProjectId,
    title: title.slice(0, 40) || '未命名卡片',
    goal: title,
    state: 'QUEUED',
    overlays: [],
    priority: 'normal',
    manualOrder: maxOrder + 10,
    dependsOn: [],
    cost: 0,
    liveTail: '快速建卡 · 等待调度',
    acceptance: [{ text: '实现目标并补充至少 1 条可验证标准', status: 'pending', evidence: '' }],
    files: [],
    activity: [{ at: nowLabel(), who: 'human', text: '⌘↵ 快速建卡入场' }],
    runs: [],
    diff: null,
    helpQuestion: null,
  });
  state.feedDraft = '';
  state.planPreview = null;
  toast('快速建卡已入场');
  render();
}

function runPlanner(text) {
  state.planPreview = {
    source: text,
    cards: [
      {
        title: '快捷键基础设施',
        goal: '统一热键注册与冲突检测',
        acceptance: ['注册表可查询绑定', '冲突时控制台告警'],
        files: 3,
        warn: false,
        depends: null,
      },
      {
        title: '验收台快捷键接入',
        goal: 'j/k/a/r/t 接到验收台',
        acceptance: ['e2e 覆盖 j/k/a/r', '提示不挡主 diff（主观）'],
        files: 2,
        warn: true,
        depends: '①',
      },
      {
        title: '状态栏成本改造',
        goal: '支持今日/本周切换',
        acceptance: ['状态栏显示本周累计'],
        files: 1,
        warn: false,
        depends: null,
      },
    ],
  };
  toast('Planner 拆出 3 张卡（可编辑预览）');
  render();
}

function admitPlan() {
  if (!state.planPreview) return;
  const base = Math.max(0, ...cardsOf().map((c) => c.manualOrder || 0));
  state.planPreview.cards.forEach((pc, idx) => {
    const id = `card-plan-${Date.now()}-${idx}`;
    const ready = !pc.depends;
    state.cards.push({
      id,
      projectId: state.activeProjectId,
      title: pc.title,
      goal: pc.goal,
      state: ready ? 'READY' : 'QUEUED',
      overlays: [],
      priority: 'normal',
      manualOrder: base + (idx + 1) * 10,
      dependsOn: [],
      cost: 0,
      liveTail: ready ? '已占槽，待派发' : `依赖 ${pc.depends} 未齐`,
      acceptance: pc.acceptance.map((t) => ({
        text: t,
        status: t.includes('主观') ? 'human' : 'pending',
        evidence: '',
      })),
      files: [],
      activity: [{ at: nowLabel(), who: 'planner', text: '拆卡入场' }],
      runs: ready ? [{ id: `run-${id}`, kind: 'develop', state: 'ready' }] : [],
      diff: null,
      helpQuestion: null,
    });
  });
  state.planPreview = null;
  state.feedDraft = '';
  toast('全部入场：无依赖卡进入 Dev');
  render();
}

/* ---------------- render ---------------- */

function render() {
  ensureBoardTabTitle();
  renderSidebar();
  renderTabbar();
  renderContent();
  renderStatusbar();
  renderInbox();
  renderDrawer();
}

function renderSidebar() {
  $('inboxBadge').textContent = String(unreadInbox().length);
  $('inboxBadge').className = `badge ${unreadInbox().length ? 'warn' : ''}`;
  $('inboxBtn').classList.toggle('active', state.inboxOpen);

  const list = $('projectList');
  list.innerHTML = state.projects
    .map((p) => {
      const awaitN = awaitingCards(p.id).length;
      const runN = runningCount(p.id);
      return `
        <button class="project-item ${p.id === state.activeProjectId ? 'active' : ''}" data-project="${p.id}" type="button">
          <span class="project-left">
            <span class="nav-icon">📁</span>
            <span class="project-name">${escapeHtml(p.name)}</span>
          </span>
          <span class="project-meta">
            ${runN ? `<span class="badge accent" title="运行中">${runN}</span>` : ''}
            ${awaitN ? `<span class="badge ok" title="待验收">${awaitN}</span>` : ''}
          </span>
        </button>
      `;
    })
    .join('');

  list.querySelectorAll('[data-project]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeProjectId = btn.dataset.project;
      state.activeTabId = 'board';
      state.planPreview = null;
      state.drawer.open = false;
      render();
    });
  });

  $('settingsNavBtn').classList.toggle(
    'active',
    state.tabs.some((t) => t.id === state.activeTabId && t.kind === 'settings')
  );
}

function renderTabbar() {
  const host = $('tabbar');
  const acceptCount = awaitingCards().length;
  host.innerHTML = state.tabs
    .map((t) => {
      let title = t.title;
      if (t.kind === 'accept') title = `验收台 (${acceptCount})`;
      if (t.kind === 'board') title = `${project().name} · 看板`;
      return `
        <button class="tab ${t.id === state.activeTabId ? 'active' : ''}" data-tab="${t.id}" type="button">
          <span>${escapeHtml(title)}</span>
          ${t.closable ? `<span class="close-x" data-close="${t.id}" title="关闭">✕</span>` : ''}
        </button>
      `;
    })
    .join('');

  host.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const closeId = e.target.dataset.close;
      if (closeId) {
        e.stopPropagation();
        closeTab(closeId);
        render();
        return;
      }
      state.activeTabId = btn.dataset.tab;
      render();
    });
  });
}

function renderStatusbar() {
  const p = project();
  const worktrees = cardsOf().filter((c) =>
    ['READY', 'RUNNING', 'FIXING', 'REVIEWING', 'AWAITING_ACCEPTANCE', 'MERGING'].includes(c.state)
  ).length;
  const changed = cardsOf()
    .filter((c) => c.diff)
    .reduce((sum, c) => sum + c.diff.reduce((s, f) => s + f.plus + f.minus, 0), 0);
  $('statusbar').innerHTML = `
    <div>
      <strong>${escapeHtml(p.branch)}</strong>
      · ${worktrees} worktrees
      · +${Math.round(changed * 0.62)}/−${Math.round(changed * 0.18)}
    </div>
    <div style="display:flex;align-items:center;gap:8px;">
      <span class="dot ${p.providerHealthy === false || !state.provider.healthy ? 'danger' : ''}"></span>
      <span>${escapeHtml(state.provider.name)} ✓</span>
      <span>今日 $${p.costToday.toFixed(2)}</span>
      <span>槽位 ${countUsedSlots()}/${state.globalSlots}</span>
    </div>
  `;
}

function countUsedSlots() {
  return state.cards.filter((c) =>
    c.projectId && ['READY', 'RUNNING', 'FIXING'].includes(c.state) && !c.overlays.includes('TAKEN_OVER')
  ).length;
}

function renderContent() {
  const tab = state.tabs.find((t) => t.id === state.activeTabId) || state.tabs[0];
  const host = $('content');
  if (tab.kind === 'board') host.innerHTML = renderBoard();
  else if (tab.kind === 'accept') host.innerHTML = renderAccept();
  else if (tab.kind === 'takeover') host.innerHTML = renderTakeover(tab.cardId);
  else if (tab.kind === 'settings') host.innerHTML = renderSettings();
  else host.innerHTML = `<div class="empty-view empty-state"><div><h3>未知视图</h3></div></div>`;
  bindContentEvents(tab);
}

function renderBoard() {
  const grouped = Object.fromEntries(COLUMNS.map((c) => [c.id, []]));
  cardsOf()
    .slice()
    .sort((a, b) => {
      const pr = { high: 0, normal: 1, low: 2 };
      return (pr[a.priority] - pr[b.priority]) || (a.manualOrder - b.manualOrder);
    })
    .forEach((card) => {
      const col = COLUMNS.find((c) => c.states.includes(card.state));
      if (col) grouped[col.id].push(card);
    });

  const plan = state.planPreview
    ? `
      <div class="plan-panel">
        <div class="plan-head">
          <div>
            <div class="panel-title">Planner 拆出 ${state.planPreview.cards.length} 张卡</div>
            <div class="panel-sub">可编辑预览 · 黄框 = 验收标准可验证性不足</div>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn ghost" id="planCancel" type="button">取消</button>
            <button class="btn primary" id="planAdmit" type="button">全部入场</button>
          </div>
        </div>
        <div class="plan-grid">
          ${state.planPreview.cards
            .map(
              (c, i) => `
            <div class="plan-card ${c.warn ? 'warn' : ''}">
              <h4>${i + 1} · ${escapeHtml(c.title)}</h4>
              <p>${escapeHtml(c.goal)}</p>
              <ul>${c.acceptance.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ul>
              <p style="margin-top:8px;">涉及 ${c.files} 文件 ${c.depends ? `· 依赖 ${c.depends}` : '· 独立'}</p>
            </div>`
            )
            .join('')}
        </div>
      </div>
    `
    : '';

  return `
    <div class="board-view">
      <div class="feed-bar">
        <div class="feed-input-wrap">
          <span aria-hidden="true">✨</span>
          <input id="feedInput" value="${escapeAttr(state.feedDraft)}" placeholder="描述一个需求，Planner 帮你拆卡…" />
        </div>
        <button class="btn" id="quickCreateBtn" type="button" title="跳过 planner">⌘↵ 快速建卡</button>
      </div>
      <div class="inline-note">拖拽仅限 Backlog 列内排序 · 禁止跨列拖动（v0.3）· 列流转由状态机驱动</div>
      ${plan}
      <div class="columns">
        ${COLUMNS.map((col) => {
          const items = grouped[col.id];
          const extra =
            col.id === 'accept'
              ? `<button class="btn sm" data-open-accept type="button">进入验收台</button>`
              : col.id === 'backlog'
                ? `<span class="chip">可排序</span>`
                : '';
          return `
            <section class="column ${col.id} ${col.id === 'backlog' ? 'sortable' : ''}" data-col="${col.id}">
              <div class="column-head">
                <div class="column-title">
                  <span>${col.title}</span>
                  <span class="count">${items.length}</span>
                  ${col.id === 'dev' && items.some((c) => c.state !== 'QUEUED') ? '🤖' : ''}
                  ${col.id === 'accept' ? '👤' : ''}
                </div>
                ${extra}
              </div>
              <div class="column-body" data-col-body="${col.id}">
                ${items.map((card) => renderCard(card, col.id === 'backlog')).join('') || emptyCol(col.id)}
              </div>
            </section>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function emptyCol(colId) {
  const map = {
    backlog: '进料口扔需求，或 ⌘↵ 快速建卡',
    dev: '调度器占槽后卡片会出现在这里',
    review: '开发完成自动进审查',
    accept: 'AI 过审后等人批改',
    done: '验收通过后归档',
  };
  return `<div class="panel-sub" style="padding:8px;">${map[colId]}</div>`;
}

function renderCard(card, draggable) {
  const overlays = card.overlays
    .map((o) => {
      if (o === 'HELP') return `<span class="pill help">🆘 求助</span>`;
      if (o === 'FAILED') return `<span class="pill fail">失败</span>`;
      if (o === 'PAUSED') return `<span class="pill pause">预算</span>`;
      if (o === 'TAKEN_OVER') return `<span class="pill live">接管中</span>`;
      return '';
    })
    .join('');
  const dep =
    card.dependsOn?.length
      ? `<span class="pill">🔗 ${card.dependsOn.length}</span>`
      : '';
  const cost = card.cost ? `<span class="pill">$${card.cost.toFixed(2)}</span>` : '';
  const stateClass =
    card.state === 'AWAITING_ACCEPTANCE'
      ? 'awaiting'
      : card.state.toLowerCase().replaceAll('_', '-');
  return `
    <button class="card state-${stateClass}" data-card="${card.id}" type="button"
      ${draggable ? `draggable="true"` : ''}
      data-draggable="${draggable ? '1' : '0'}">
      <div class="title">${escapeHtml(card.title)}</div>
      <div class="tail">${escapeHtml(card.liveTail || STATE_LABEL[card.state] || card.state)}</div>
      <div class="meta-row">
        <span class="pill ${['RUNNING', 'FIXING', 'READY'].includes(card.state) ? 'live' : ''}">${STATE_LABEL[card.state] || card.state}</span>
        ${card.priority === 'high' ? `<span class="pill">高优</span>` : ''}
        ${dep}${overlays}${cost}
      </div>
    </button>
  `;
}

function renderAccept() {
  const queue = awaitingCards();
  if (!queue.length) {
    return `
      <div class="empty-view empty-state">
        <div>
          <h3>没有待验收卡片</h3>
          <p>AI 审查通过后会出现在这里。人只处理最终验收。</p>
          <div style="margin-top:14px;"><button class="btn" data-back-board type="button">回看板</button></div>
        </div>
      </div>
    `;
  }
  let selected = cardById(state.acceptSelectedId);
  if (!selected || selected.state !== 'AWAITING_ACCEPTANCE') {
    selected = queue[0];
    state.acceptSelectedId = selected.id;
  }
  return `
    <div class="accept-view">
      <div class="accept-queue">
        <div class="panel-block">
          <div class="panel-title">队列 ${queue.length}</div>
          <div class="panel-sub">j/k 切换 · a 通过 · r 打回</div>
        </div>
        ${queue
          .map(
            (c) => `
          <button class="queue-item ${c.id === selected.id ? 'active' : ''}" data-select-accept="${c.id}" type="button">
            <div class="q-title">${escapeHtml(c.title)}</div>
            <div class="q-sub">$${c.cost.toFixed(2)} · ${c.acceptance.filter((a) => a.status === 'human').length ? '含人工项' : 'AI 已过'}</div>
          </button>`
          )
          .join('')}
      </div>
      <div class="accept-diff">
        <div class="panel-block" style="border-bottom:1px solid var(--line-soft);">
          <div class="panel-title">${escapeHtml(selected.title)}</div>
          <div class="panel-sub">${escapeHtml(selected.goal)}</div>
        </div>
        ${(selected.diff || [])
          .map(
            (file) => `
          <div class="diff-file">
            <div class="diff-file-head">
              <span>${escapeHtml(file.file)}</span>
              <span>+${file.plus} −${file.minus}</span>
            </div>
            <div class="diff-body">
              ${file.lines
                .map((line) => {
                  const cls = line.type === 'add' ? 'add' : line.type === 'del' ? 'del' : '';
                  return `<div class="diff-line ${cls}"><span class="ln">${line.ln}</span><span>${escapeHtml(line.text)}</span></div>`;
                })
                .join('')}
            </div>
          </div>`
          )
          .join('') || `<div class="panel-block panel-sub">无 diff 样例</div>`}
      </div>
      <div class="accept-side">
        <div class="panel-block">
          <div class="panel-title">验收标准</div>
          <div class="panel-sub">AI 预填 · 人工项高亮</div>
          ${selected.acceptance
            .map((a) => {
              const mark =
                a.status === 'pass' ? '✓' : a.status === 'human' ? '!' : a.status === 'fail' ? '✗' : '·';
              const cls =
                a.status === 'pass' ? 'mark' : a.status === 'human' ? 'mark human' : a.status === 'fail' ? 'mark bad' : 'mark';
              return `
                <div class="check-item">
                  <div class="${cls}">${mark}</div>
                  <div>
                    <div>${escapeHtml(a.text)}</div>
                    <div class="hint">${
                      a.status === 'human'
                        ? '需人工判断'
                        : a.evidence
                          ? escapeHtml(a.evidence)
                          : '待核查'
                    }</div>
                  </div>
                </div>`;
            })
            .join('')}
          <div class="action-stack">
            <button class="btn primary" data-pass="${selected.id}" type="button">✓ 通过 (a)</button>
            <button class="btn danger" data-reject="${selected.id}" type="button">↩ 打回 (r)</button>
            <button class="btn" data-takeover="${selected.id}" type="button">💬 接管 (t)</button>
            <button class="btn ghost" data-open-card="${selected.id}" type="button">打开卡片详情</button>
          </div>
          <div class="shortcut-hint">
            通过后按项目 deliveryMode=<strong>${project().deliveryMode}</strong> 执行系统 merge 任务。<br/>
            队列清空自动关闭回看板。
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderTakeover(cardId) {
  const card = cardById(cardId);
  if (!card) {
    return `<div class="empty-state"><div><h3>会话已不存在</h3></div></div>`;
  }
  const messages = card.takeoverMessages || [];
  return `
    <div class="session-view session-layout">
      <div class="session-head">
        <div>
          <div class="panel-title">💬 接管 · ${escapeHtml(card.title)}</div>
          <div class="panel-sub">TAKEN_OVER · 自动调度已暂停 · 槽位已释放</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn" data-open-card="${card.id}" type="button">卡片详情</button>
          <button class="btn primary" data-return="${card.id}" type="button">交还</button>
        </div>
      </div>
      <div class="session-stream">
        ${messages
          .map(
            (m) => `
          <div class="msg ${m.who === 'user' ? 'user' : ''}">
            <div class="who">${m.who === 'user' ? '你' : 'agent'}</div>
            <div class="body">${escapeHtml(m.text)}</div>
          </div>`
          )
          .join('')}
      </div>
      <div class="session-input">
        <input id="takeoverInput" placeholder="像 Claude Code 一样直接指挥…" value="${escapeAttr(state.takeoverDraft)}" />
        <button class="btn primary" id="takeoverSend" type="button">发送</button>
      </div>
    </div>
  `;
}

function renderSettings() {
  const p = project();
  const tab = state.settingsTab;
  const nav = [
    ['general', '通用'],
    ['project', '项目'],
    ['team', '团队'],
    ['stats', '统计'],
  ];
  let body = '';
  if (tab === 'general') {
    body = `
      <h3>通用</h3>
      <p class="lead">全局调度与护栏。开发/修复占槽；review/plan 不占槽。</p>
      <div class="field">
        <label>全局并发槽位</label>
        <input id="setSlots" type="number" min="1" max="8" value="${state.globalSlots}" />
      </div>
      <div class="field">
        <label>Watchdog 超时（分钟）</label>
        <input type="number" value="30" />
      </div>
      <div class="field">
        <label>桌面通知</label>
        <select><option>开启（v1 唯一触达）</option><option>关闭</option></select>
      </div>
    `;
  } else if (tab === 'project') {
    body = `
      <h3>项目 · ${escapeHtml(p.name)}</h3>
      <p class="lead">v1 一看板一仓库。deliveryMode 决定验收通过后的系统交付动作。</p>
      <div class="field">
        <label>仓库路径</label>
        <input value="${escapeAttr(p.repo)}" />
      </div>
      <div class="field">
        <label>deliveryMode</label>
        <select id="setDelivery">
          <option value="auto-merge" ${p.deliveryMode === 'auto-merge' ? 'selected' : ''}>auto-merge（默认 squash）</option>
          <option value="pr" ${p.deliveryMode === 'pr' ? 'selected' : ''}>pr（建 PR 后 DONE）</option>
          <option value="branch" ${p.deliveryMode === 'branch' ? 'selected' : ''}>branch（仅推分支）</option>
        </select>
      </div>
      <div class="field">
        <label>默认单卡预算 (USD)</label>
        <input type="number" step="0.1" value="2.0" />
      </div>
    `;
  } else if (tab === 'team') {
    body = `
      <h3>团队配置</h3>
      <p class="lead">specialist 角色与模型。原型只展示信息架构。</p>
      <div class="team-list">
        ${[
          ['planner', '只读扫库，拆卡 + 可验证验收标准'],
          ['developer', 'worktree 内实现，可升级求助'],
          ['reviewer', '对照验收标准审查，不改业务代码'],
        ]
          .map(
            ([role, desc]) => `
          <div class="team-row">
            <div>
              <div class="role">${role}</div>
              <div class="desc">${desc}</div>
            </div>
            <span class="chip">sonnet</span>
          </div>`
          )
          .join('')}
      </div>
    `;
  } else {
    body = `
      <h3>统计（北极星）</h3>
      <p class="lead">v1 不做独立报表页；五项指标放设置 → 统计分区。</p>
      <div class="stat-grid">
        <div class="stat-card"><div class="label">人均介入时间/卡</div><div class="value">3.8 分</div><div class="hint">目标 &lt; 5 分钟</div></div>
        <div class="stat-card"><div class="label">首次验收通过率</div><div class="value">74%</div><div class="hint">目标 ≥ 70%</div></div>
        <div class="stat-card"><div class="label">无人值守跨度</div><div class="value">2.4 h</div><div class="hint">目标 ≥ 2 小时</div></div>
        <div class="stat-card"><div class="label">自动打回收敛轮次</div><div class="value">1</div><div class="hint">中位数目标 ≤ 1</div></div>
      </div>
    `;
  }
  return `
    <div class="settings-view settings-grid">
      <div class="settings-nav">
        ${nav
          .map(
            ([id, label]) =>
              `<button type="button" data-settings-tab="${id}" class="${tab === id ? 'active' : ''}">${label}</button>`
          )
          .join('')}
      </div>
      <div class="settings-body">${body}</div>
    </div>
  `;
}

function renderInbox() {
  const panel = $('inboxPanel');
  panel.classList.toggle('hidden', !state.inboxOpen);
  const items = state.inbox.filter((i) => i.projectId === state.activeProjectId || true);
  $('inboxList').innerHTML =
    items
      .map((item) => {
        const typeLabel = {
          AWAITING_ACCEPTANCE: '待验收',
          HELP: '求助',
          FAILED: '失败',
          BUDGET: '成本超限',
        }[item.type];
        return `
          <button class="inbox-item" data-inbox="${item.id}" type="button">
            <div class="type">${typeLabel}${item.unread ? ' · 未读' : ''}</div>
            <div class="title">${escapeHtml(item.title)}</div>
            <div class="sub">${escapeHtml(item.sub)}</div>
          </button>
        `;
      })
      .join('') || `<div class="panel-sub" style="padding:12px;">收件箱空了。好现象。</div>`;
}

function renderDrawer() {
  const scrim = $('drawerScrim');
  const drawer = $('cardDrawer');
  if (!state.drawer.open) {
    scrim.classList.add('hidden');
    drawer.classList.add('hidden');
    return;
  }
  const card = cardById(state.drawer.cardId);
  if (!card) {
    state.drawer.open = false;
    scrim.classList.add('hidden');
    drawer.classList.add('hidden');
    return;
  }
  scrim.classList.remove('hidden');
  drawer.classList.remove('hidden');
  const tab = state.drawer.tab;
  const tabs = [
    ['overview', '概览'],
    ['acceptance', '验收标准'],
    ['activity', '活动流'],
    ['changes', '变更'],
    ['history', '历史'],
  ];
  let body = '';
  if (tab === 'overview') {
    body = `
      <div class="kv">
        <div class="k">状态</div><div>${STATE_LABEL[card.state]} ${card.overlays.map((o) => `· ${o}`).join('')}</div>
        <div class="k">目标</div><div>${escapeHtml(card.goal)}</div>
        <div class="k">优先级</div><div>${card.priority}</div>
        <div class="k">成本</div><div>$${card.cost.toFixed(2)}</div>
        <div class="k">依赖</div><div>${card.dependsOn?.length ? card.dependsOn.join(', ') : '无'}</div>
        <div class="k">文件</div><div>${(card.files || []).map(escapeHtml).join(', ') || '—'}</div>
      </div>
      ${
        card.helpQuestion
          ? `<div class="help-box">
              <div class="panel-title">🆘 ${escapeHtml(card.helpQuestion.title)}</div>
              <div class="panel-sub" style="margin-top:6px;">${card.helpQuestion.options.map(escapeHtml).join('<br/>')}</div>
              <textarea id="helpReply" placeholder="轻回复一句，注入原 Run…">走 ${card.helpQuestion.prefer}，旧数据不多</textarea>
              <div style="margin-top:8px;display:flex;gap:8px;">
                <button class="btn primary" data-help-send="${card.id}" type="button">发送回复</button>
                <button class="btn" data-takeover="${card.id}" type="button">重接管</button>
              </div>
            </div>`
          : ''
      }
    `;
  } else if (tab === 'acceptance') {
    body = card.acceptance
      .map((a) => {
        const mark = a.status === 'pass' ? '✓' : a.status === 'human' ? '需人工' : a.status === 'fail' ? '✗' : '·';
        return `<div class="timeline-item"><strong>${mark}</strong> ${escapeHtml(a.text)}<div class="when">${escapeHtml(a.evidence || '')}</div></div>`;
      })
      .join('');
  } else if (tab === 'activity') {
    body = `<div class="timeline">${card.activity
      .map(
        (a) => `
        <div class="timeline-item">
          <div class="when">${escapeHtml(a.at)} · ${escapeHtml(a.who)}</div>
          <div>${escapeHtml(a.text)}</div>
        </div>`
      )
      .join('')}</div>`;
  } else if (tab === 'changes') {
    body =
      (card.diff || [])
        .map(
          (f) => `
        <div class="timeline-item">
          <strong>${escapeHtml(f.file)}</strong>
          <div class="when">+${f.plus} −${f.minus}</div>
        </div>`
        )
        .join('') || `<div class="panel-sub">暂无变更</div>`;
  } else {
    body =
      (card.runs || [])
        .map(
          (r) => `
        <div class="timeline-item">
          <strong>${r.kind}</strong> · ${r.state}
          <div class="when">${r.id}</div>
        </div>`
        )
        .join('') || `<div class="panel-sub">尚无 Run</div>`;
  }

  drawer.innerHTML = `
    <div class="drawer-head">
      <div>
        <h2>${escapeHtml(card.title)}</h2>
        <div class="panel-sub" style="margin-top:4px;">${escapeHtml(card.liveTail || '')}</div>
      </div>
      <div class="drawer-actions">
        ${card.state === 'AWAITING_ACCEPTANCE' ? `<button class="btn sm" data-open-accept-card="${card.id}" type="button">在验收台打开</button>` : ''}
        <button class="btn sm" data-takeover="${card.id}" type="button">接管 t</button>
        <button class="icon-btn" id="drawerClose" type="button" aria-label="关闭">✕</button>
      </div>
    </div>
    <div class="drawer-tabs">
      ${tabs
        .map(
          ([id, label]) =>
            `<button type="button" data-drawer-tab="${id}" class="${tab === id ? 'active' : ''}">${label}</button>`
        )
        .join('')}
    </div>
    <div class="drawer-body">${body}</div>
  `;

  drawer.querySelector('#drawerClose')?.addEventListener('click', closeDrawer);
  drawer.querySelectorAll('[data-drawer-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.drawer.tab = btn.dataset.drawerTab;
      render();
    });
  });
  drawer.querySelectorAll('[data-takeover]').forEach((btn) => {
    btn.addEventListener('click', () => openTakeover(btn.dataset.takeover));
  });
  drawer.querySelectorAll('[data-open-accept-card]').forEach((btn) => {
    btn.addEventListener('click', () => openAcceptance(btn.dataset.openAcceptCard));
  });
  drawer.querySelectorAll('[data-help-send]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const text = drawer.querySelector('#helpReply')?.value || '';
      replyHelp(btn.dataset.helpSend, text);
    });
  });
}

function bindContentEvents(tab) {
  const root = $('content');

  root.querySelectorAll('[data-card]').forEach((btn) => {
    btn.addEventListener('click', () => openDrawer(btn.dataset.card));
  });

  root.querySelectorAll('[data-open-accept]').forEach((btn) => {
    btn.addEventListener('click', () => openAcceptance());
  });
  root.querySelectorAll('[data-back-board]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeTabId = 'board';
      render();
    });
  });
  root.querySelectorAll('[data-select-accept]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.acceptSelectedId = btn.dataset.selectAccept;
      render();
    });
  });
  root.querySelectorAll('[data-pass]').forEach((btn) => {
    btn.addEventListener('click', () => passCard(btn.dataset.pass));
  });
  root.querySelectorAll('[data-reject]').forEach((btn) => {
    btn.addEventListener('click', () => rejectCard(btn.dataset.reject));
  });
  root.querySelectorAll('[data-takeover]').forEach((btn) => {
    btn.addEventListener('click', () => openTakeover(btn.dataset.takeover));
  });
  root.querySelectorAll('[data-open-card]').forEach((btn) => {
    btn.addEventListener('click', () => openDrawer(btn.dataset.openCard));
  });
  root.querySelectorAll('[data-return]').forEach((btn) => {
    btn.addEventListener('click', () => returnFromTakeover(btn.dataset.return));
  });
  root.querySelectorAll('[data-settings-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.settingsTab = btn.dataset.settingsTab;
      render();
    });
  });

  const feed = root.querySelector('#feedInput');
  if (feed) {
    feed.addEventListener('input', () => {
      state.feedDraft = feed.value;
    });
    feed.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        quickCreateCard(feed.value.trim() || '快速卡片');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (!feed.value.trim()) return;
        runPlanner(feed.value.trim());
      }
    });
  }
  root.querySelector('#quickCreateBtn')?.addEventListener('click', () => {
    quickCreateCard(state.feedDraft.trim() || '快速卡片');
  });
  root.querySelector('#planCancel')?.addEventListener('click', () => {
    state.planPreview = null;
    render();
  });
  root.querySelector('#planAdmit')?.addEventListener('click', admitPlan);

  root.querySelector('#setDelivery')?.addEventListener('change', (e) => {
    project().deliveryMode = e.target.value;
    toast(`deliveryMode = ${e.target.value}`);
    render();
  });
  root.querySelector('#setSlots')?.addEventListener('change', (e) => {
    state.globalSlots = Math.max(1, Number(e.target.value) || 2);
    toast(`全局槽位 = ${state.globalSlots}`);
    render();
  });

  const takeoverInput = root.querySelector('#takeoverInput');
  const sendTakeover = () => {
    const card = cardById(tab.cardId);
    if (!card || !takeoverInput) return;
    const text = takeoverInput.value.trim();
    if (!text) return;
    card.takeoverMessages = card.takeoverMessages || [];
    card.takeoverMessages.push({ who: 'user', text });
    card.takeoverMessages.push({
      who: 'agent',
      text: '收到。我会在当前 worktree 继续改，交还前不会自动进审查。',
    });
    state.takeoverDraft = '';
    render();
  };
  root.querySelector('#takeoverSend')?.addEventListener('click', sendTakeover);
  takeoverInput?.addEventListener('input', () => {
    state.takeoverDraft = takeoverInput.value;
  });
  takeoverInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendTakeover();
    }
  });

  // Backlog sort only
  let dragId = null;
  root.querySelectorAll('.card[data-draggable="1"]').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      dragId = el.dataset.card;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      dragId = null;
      root.querySelectorAll('.card').forEach((c) => c.classList.remove('drag-over'));
    });
    el.addEventListener('dragover', (e) => {
      if (!dragId || dragId === el.dataset.card) return;
      e.preventDefault();
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      if (!dragId || dragId === el.dataset.card) return;
      const from = cardById(dragId);
      const to = cardById(el.dataset.card);
      if (!from || !to) return;
      if (from.state !== 'QUEUED' && from.state !== 'BLOCKED') {
        toast('只能在 Backlog 内排序');
        return;
      }
      if (to.state !== 'QUEUED' && to.state !== 'BLOCKED') {
        toast('禁止跨列拖动');
        return;
      }
      const tmp = from.manualOrder;
      from.manualOrder = to.manualOrder;
      to.manualOrder = tmp;
      toast('已更新 Backlog 排序（影响出队顺序）');
      render();
    });
  });

  // Prevent cross-column visual affordance
  root.querySelectorAll('[data-col-body]').forEach((body) => {
    body.addEventListener('dragover', (e) => {
      if (body.dataset.colBody !== 'backlog') {
        e.dataTransfer.dropEffect = 'none';
      }
    });
  });
}

function escapeHtml(str = '') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
function escapeAttr(str = '') {
  return escapeHtml(str).replaceAll("'", '&#39;');
}

/* global chrome events */
$('inboxBtn').addEventListener('click', () => {
  state.inboxOpen = !state.inboxOpen;
  render();
});
$('inboxClose').addEventListener('click', () => {
  state.inboxOpen = false;
  render();
});
$('drawerScrim').addEventListener('click', closeDrawer);
$('settingsNavBtn').addEventListener('click', () => {
  openTab({ id: 'settings', kind: 'settings', title: '设置', closable: true });
  state.inboxOpen = false;
  render();
});
$('inboxList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-inbox]');
  if (!btn) return;
  const item = state.inbox.find((i) => i.id === btn.dataset.inbox);
  if (!item) return;
  item.unread = false;
  state.activeProjectId = item.projectId;
  if (item.type === 'AWAITING_ACCEPTANCE') openAcceptance(item.cardId);
  else {
    state.inboxOpen = false;
    openDrawer(item.cardId, item.type === 'HELP' ? 'overview' : 'activity');
  }
});

document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA';
  if (e.key === 'Escape') {
    if (state.drawer.open) {
      closeDrawer();
      return;
    }
    if (state.inboxOpen) {
      state.inboxOpen = false;
      render();
    }
    return;
  }
  if (!typing && (e.key === 'i' || e.key === 'I') && !e.metaKey && !e.ctrlKey) {
    state.inboxOpen = !state.inboxOpen;
    render();
    return;
  }
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  if (!tab || tab.kind !== 'accept' || typing) return;
  const queue = awaitingCards();
  if (!queue.length) return;
  const idx = Math.max(0, queue.findIndex((c) => c.id === state.acceptSelectedId));
  if (e.key === 'j' || e.key === 'J') {
    state.acceptSelectedId = queue[Math.min(queue.length - 1, idx + 1)].id;
    render();
  } else if (e.key === 'k' || e.key === 'K') {
    state.acceptSelectedId = queue[Math.max(0, idx - 1)].id;
    render();
  } else if (e.key === 'a' || e.key === 'A') {
    passCard(state.acceptSelectedId);
  } else if (e.key === 'r' || e.key === 'R') {
    rejectCard(state.acceptSelectedId);
  } else if (e.key === 't' || e.key === 'T') {
    openTakeover(state.acceptSelectedId);
  }
});

render();
