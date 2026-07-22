/* Koda 活原型 v0.4 — 主程序：状态动作 / 事件 / 键盘 / FLIP / 演示模式 */
import {
  createInitialState,
  GENERIC_DEV_STEPS,
  GENERIC_CRITERIA,
  GENERIC_DIFF,
  PLANNER_STREAM_LINES,
  PLANNER_DRAFTS,
  STATE_COLUMN,
} from './data.js';
import { Sim } from './sim.js';
import {
  renderSidebar,
  renderTabbar,
  renderStatusbar,
  renderBoard,
  renderDrawer,
  renderAccept,
  renderTakeover,
  renderInbox,
  renderSettings,
  toastHtml,
} from './views.js';

const state = createInitialState();
state.intakeDraft = '';

const $ = (id) => document.getElementById(id);
const els = {
  sidebar: $('sidebar'),
  tabbar: $('tabbar'),
  content: $('content'),
  statusbar: $('statusbar'),
};

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ============ 渲染 ============ */

let flipRects = null;

function snapshotFlip() {
  if (reducedMotion) return;
  flipRects = new Map();
  document.querySelectorAll('[data-card-id]').forEach((el) => {
    flipRects.set(el.dataset.cardId, el.getBoundingClientRect());
  });
}

function applyFlip() {
  if (reducedMotion || !flipRects) return;
  document.querySelectorAll('[data-card-id]').forEach((el) => {
    const old = flipRects.get(el.dataset.cardId);
    if (!old) return;
    const now = el.getBoundingClientRect();
    const dx = old.left - now.left;
    const dy = old.top - now.top;
    if (!dx && !dy) return;
    el.classList.remove('flip');
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => {
      el.classList.add('flip');
      el.style.transform = '';
    });
  });
  flipRects = null;
}

function activeTab() {
  return state.tabs.find((t) => t.id === state.activeTabId);
}

function renderContent() {
  const tab = activeTab();
  if (!tab || tab.kind === 'board') els.content.innerHTML = renderBoard(state);
  else if (tab.kind === 'accept') els.content.innerHTML = renderAccept(state);
  else if (tab.kind === 'takeover') els.content.innerHTML = renderTakeover(state, tab);
  else if (tab.kind === 'settings') els.content.innerHTML = renderSettings(state);
}

function render(structural = true) {
  if (structural) snapshotFlip();
  els.sidebar.innerHTML = renderSidebar(state);
  els.tabbar.innerHTML = renderTabbar(state);
  renderContent();
  els.statusbar.innerHTML = renderStatusbar(state);
  renderDrawer(state);
  renderInbox(state);
  if (structural) requestAnimationFrame(applyFlip);
  restoreFocus();
}

/* 轻量刷新：tick 无结构变化时只更新活体部位，不打断输入焦点 */
function patch() {
  els.statusbar.innerHTML = renderStatusbar(state);
  document.querySelectorAll('[data-tail]').forEach((el) => {
    const card = state.cards.find((c) => c.id === el.dataset.tail);
    if (card && el.textContent !== card.liveTail) el.textContent = card.liveTail;
  });
  document.querySelectorAll('[data-cost]').forEach((el) => {
    const card = state.cards.find((c) => c.id === el.dataset.cost);
    if (card) el.textContent = `$${card.cost.toFixed(2)}`;
  });
  // 侧栏徽章 & 标签页计数也顺手更新
  els.sidebar.innerHTML = renderSidebar(state);
  els.tabbar.innerHTML = renderTabbar(state);
  // 抽屉/验收台开着时，内容随 tick 变化 → 结构刷新（焦点不在看板输入框时安全）
  const typingInIntake = document.activeElement?.id === 'intakeInput';
  const typingInTk = document.activeElement?.id === 'tkInput';
  const typingInHelp = document.activeElement?.id === 'helpReplyInput';
  if (!typingInIntake && !typingInTk && !typingInHelp) {
    if (state.drawer.open) renderDrawer(state);
    const tab = activeTab();
    if (tab?.kind === 'accept') renderContent();
    if (tab?.kind === 'takeover') {
      // 只滚到底，不重渲染打断输入
      const stream = $('tkStream');
      if (stream) stream.scrollTop = stream.scrollHeight;
    }
  }
}

/* 焦点保护 */
let focusMemo = null;
function saveFocus() {
  const el = document.activeElement;
  if (el && (el.id === 'intakeInput' || el.id === 'tkInput' || el.id === 'rejectComment' || el.id === 'helpReplyInput')) {
    focusMemo = { id: el.id, sel: el.selectionStart ?? null };
  } else {
    focusMemo = null;
  }
}
function restoreFocus() {
  if (!focusMemo) return;
  const el = $(focusMemo.id);
  if (el) {
    el.focus();
    if (focusMemo.sel != null && el.setSelectionRange) {
      try { el.setSelectionRange(focusMemo.sel, focusMemo.sel); } catch { /* noop */ }
    }
  }
  focusMemo = null;
}

/* ============ Toast ============ */
function toast(kind, title, sub) {
  const host = $('toastHost');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = toastHtml(kind, title, sub);
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 320);
  }, 3400);
}

/* ============ 动作 ============ */

function switchProject(id) {
  state.activeProjectId = id;
  const p = state.projects.find((x) => x.id === id);
  const tab = state.tabs.find((t) => t.kind === 'board');
  if (tab) tab.title = `${p.name} · 看板`;
  state.drawer.open = false;
  state.inboxOpen = false;
  render();
}

function openTab(tab) {
  if (!state.tabs.find((t) => t.id === tab.id)) state.tabs.push(tab);
  state.activeTabId = tab.id;
}

function closeTab(id) {
  const t = state.tabs.find((x) => x.id === id);
  if (!t || !t.closable) return;
  // 关接管标签 = 自动交还
  if (t.kind === 'takeover') returnFromTakeover(t.cardId, true);
  const idx = state.tabs.findIndex((x) => x.id === id);
  state.tabs.splice(idx, 1);
  if (state.activeTabId === id) state.activeTabId = 'board';
  render();
}

function openDrawer(cardId, tab = 'overview') {
  state.drawer = { open: true, cardId, tab, full: false };
  state.inboxOpen = false;
  render();
}

function openAccept(cardId) {
  openTab({ id: 'accept', kind: 'accept', title: '验收台', closable: true });
  state.acceptSelectedId = cardId || null;
  state.rejectOpen = false;
  state.drawer.open = false;
  state.inboxOpen = false;
  render();
}

function acceptMove(delta) {
  const cards = state.cards.filter(
    (c) => c.projectId === state.activeProjectId && c.state === 'AWAITING_ACCEPTANCE'
  );
  if (!cards.length) return;
  const cur = cards.findIndex((c) => c.id === state.acceptSelectedId);
  const next = Math.min(cards.length - 1, Math.max(0, (cur < 0 ? 0 : cur) + delta));
  state.acceptSelectedId = cards[next].id;
  state.rejectOpen = false;
  render();
}

function passCard(cardId) {
  const card = state.cards.find((c) => c.id === cardId);
  if (!card || card.state !== 'AWAITING_ACCEPTANCE') return;
  sim.startMerge(card);
  markInboxDone(cardId);
  toast('success', '✓ 通过', `${card.title} 正在合并…`);
  // 自动跳下一张
  const rest = state.cards.filter(
    (c) => c.projectId === state.activeProjectId && c.state === 'AWAITING_ACCEPTANCE' && c.id !== cardId
  );
  state.acceptSelectedId = rest[0]?.id || null;
  state.rejectOpen = false;
  render();
}

function rejectCard(cardId, comment) {
  const card = state.cards.find((c) => c.id === cardId);
  if (!card || card.state !== 'AWAITING_ACCEPTANCE') return;
  card.state = 'FIXING';
  card.rejects += 1;
  card.liveTail = '🔧 按你的评语修复中…';
  card.fixSteps = [
    { tail: '消化人的评语…', ticks: 2 },
    { tail: '应用修改并重跑测试: 通过 ✓', ticks: 2 },
  ];
  card.fixIdx = 0;
  card.runs.push({ kind: 'fix', model: 'claude-sonnet', cost: 0, state: 'going', tokens: 0 });
  card.activity.unshift({ at: nowLabel(), who: 'user', text: `验收打回：「${comment}」` });
  card.activity.unshift({ at: nowLabel(), who: 'system', text: '评语注入新 FIXING Run，回到 Dev' });
  markInboxDone(cardId);
  const rest = state.cards.filter(
    (c) => c.projectId === state.activeProjectId && c.state === 'AWAITING_ACCEPTANCE' && c.id !== cardId
  );
  state.acceptSelectedId = rest[0]?.id || null;
  state.rejectOpen = false;
  toast('warn', '↩ 已打回', '评语已注入，agent 继续修');
  render();
}

function takeover(cardId) {
  const card = state.cards.find((c) => c.id === cardId);
  if (!card) return;
  if (!card.overlays.includes('TAKEN_OVER')) {
    card.overlays = [...new Set([...card.overlays, 'TAKEN_OVER'])].filter((o) => o !== 'HELP');
    card.liveTail = '👤 人在环 · 自动调度已暂停';
    card.activity.unshift({ at: nowLabel(), who: 'system', text: 'TAKEN_OVER：暂停自动调度、释放槽位' });
    markInboxDone(cardId);
  }
  if (!card.takeoverMessages) {
    card.takeoverMessages = [
      { who: 'agent', text: card.helpQuestion ? card.helpQuestion.text : `已进入接管模式。当前目标：${card.goal || card.title}` },
      { tool: 'read_file src/i18n/extract.ts' },
      { who: 'agent', text: '我已读完相关代码。你可以直接下指令，交还前不会产生新的自动 Run。' },
    ];
  }
  openTab({ id: `takeover-${card.id}`, kind: 'takeover', title: `接管 · ${card.title}`, closable: true, cardId: card.id });
  state.drawer.open = false;
  state.inboxOpen = false;
  render();
  requestAnimationFrame(() => {
    const stream = $('tkStream');
    if (stream) stream.scrollTop = stream.scrollHeight;
  });
}

function returnFromTakeover(cardId, silent) {
  const card = state.cards.find((c) => c.id === cardId);
  if (!card) return;
  card.overlays = card.overlays.filter((o) => o !== 'TAKEN_OVER');
  if (['RUNNING', 'FIXING', 'READY'].includes(card.state)) {
    card.liveTail = '⚡ 交还后继续自动流…';
    card.activity.unshift({ at: nowLabel(), who: 'system', text: '交还：清除 TAKEN_OVER，重新入队续跑' });
  } else {
    card.activity.unshift({ at: nowLabel(), who: 'system', text: '交还：回到自动流' });
  }
  if (!silent) toast('success', '已交还', `${card.title} 回到自动流`);
}

function tkSend(cardId) {
  const card = state.cards.find((c) => c.id === cardId);
  const input = $('tkInput');
  if (!card || !input || !input.value.trim()) return;
  const text = input.value.trim();
  card.takeoverMessages.push({ who: 'user', text });
  card.activity.unshift({ at: nowLabel(), who: 'user', text: `接管指令：${text}` });
  input.value = '';
  render();
  setTimeout(() => {
    card.takeoverMessages.push({ tool: 'edit src/i18n/extract.ts (+14 −3)' });
    card.takeoverMessages.push({
      who: 'agent',
      text: '收到。按「' + text.slice(0, 24) + (text.length > 24 ? '…' : '') + '」执行——改动已写入 worktree，右侧 Workbench 可见。',
    });
    const tab = activeTab();
    if (tab?.kind === 'takeover' && tab.cardId === cardId) {
      render();
      const stream = $('tkStream');
      if (stream) stream.scrollTop = stream.scrollHeight;
    }
  }, 1100);
}

function helpReply(cardId) {
  const card = state.cards.find((c) => c.id === cardId);
  const input = $('helpReplyInput');
  if (!card || !input || !input.value.trim()) return;
  const text = input.value.trim();
  card.overlays = card.overlays.filter((o) => o !== 'HELP');
  card.helpQuestion = null;
  card.state = 'RUNNING';
  card.devSteps = [
    { tail: '按你的裁决继续实现…', ticks: 2 },
    { tail: '运行测试: 通过 ✓', ticks: 2 },
    { tail: '宣告完成', ticks: 1 },
  ];
  card.devIdx = 0;
  card.liveTail = '⚡ 收到裁决，继续…';
  card.activity.unshift({ at: nowLabel(), who: 'user', text: `轻回复：「${text}」（注入原 Run）` });
  card.activity.unshift({ at: nowLabel(), who: 'agent', text: '收到，按方案继续' });
  markInboxDone(cardId);
  toast('success', '已回复', '一句话注入原 Run，agent 继续');
  render();
}

function retryCard(cardId) {
  const card = state.cards.find((c) => c.id === cardId);
  if (!card) return;
  card.overlays = card.overlays.filter((o) => o !== 'FAILED');
  card.state = 'READY';
  card.devSteps = GENERIC_DEV_STEPS.map((s) => ({ ...s }));
  card.devIdx = 0;
  card.liveTail = '⚡ 重试：新 Run 原 worktree…';
  card.activity.unshift({ at: nowLabel(), who: 'system', text: '人选择重试 → 新 Run，原 worktree' });
  markInboxDone(cardId);
  toast('success', '已重试', card.title);
  render();
}

function addBudget(cardId) {
  const card = state.cards.find((c) => c.id === cardId);
  if (!card) return;
  card.budget = +(card.budget + 2).toFixed(2);
  card.overlays = card.overlays.filter((o) => o !== 'PAUSED');
  card.liveTail = '⚡ 预算已加，继续…';
  card.activity.unshift({ at: nowLabel(), who: 'system', text: `人加预算 → $${card.budget.toFixed(2)}，恢复运行` });
  markInboxDone(cardId);
  toast('success', '已加预算', `$${card.budget.toFixed(2)}`);
  render();
}

function cancelCard(cardId) {
  const card = state.cards.find((c) => c.id === cardId);
  if (!card || ['DONE', 'CANCELLED'].includes(card.state)) return;
  card.state = 'CANCELLED';
  card.overlays = [];
  card.liveTail = '';
  card.activity.unshift({ at: nowLabel(), who: 'system', text: '人取消：终止 Run、释放槽位' });
  markInboxDone(cardId);
  toast('warn', '已取消', card.title);
  render();
}

function pauseCard(cardId) {
  const card = state.cards.find((c) => c.id === cardId);
  if (!card || card.overlays.length) return;
  card.overlays = [...card.overlays, 'PAUSED'];
  card.liveTail = '⏸ 人手动暂停';
  card.activity.unshift({ at: nowLabel(), who: 'system', text: '人暂停：等待恢复' });
  toast('warn', '已暂停', card.title);
  render();
}

function markInboxDone(cardId) {
  state.inbox.forEach((i) => {
    if (i.cardId === cardId && !i.done) {
      i.done = true;
      i.unread = false;
    }
  });
}

/* ============ 进料 & 拆卡 ============ */

function submitIntake(quick) {
  const text = (state.intakeDraft || '').trim();
  if (!text) return;
  state.intakeDraft = '';
  if (quick) {
    // ⌘↵ 快速建卡：跳过 planner
    createCardsFromText(text, false);
    toast('success', '⚡ 快速建卡', '跳过 Planner，单卡已入场');
    render();
    return;
  }
  // Planner 拆卡流
  state.split = { phase: 'streaming', request: text, lineIdx: 0, drafts: [] };
  render();
  let i = 0;
  const streamTimer = setInterval(() => {
    i += 1;
    state.split.lineIdx = i;
    render();
    if (i >= PLANNER_STREAM_LINES.length) {
      clearInterval(streamTimer);
      setTimeout(() => {
        if (!state.split) return;
        state.split.phase = 'preview';
        state.split.drafts = PLANNER_DRAFTS.map((d) => ({ ...d, criteria: [...d.criteria] }));
        render();
        if (state.demo.active) setTimeout(() => enterSplit(), 1400);
      }, 500);
    }
  }, 620);
}

function enterSplit() {
  const sp = state.split;
  if (!sp || sp.phase !== 'preview' || !sp.drafts.length) return;
  sp.drafts.forEach((d, i) => {
    const id = `c-new-${Date.now().toString(36)}-${i}`;
    const depId = d.dependsOn
      ? `c-new-${cardIdSeed(d.dependsOn)}`
      : null;
    state.cards.push({
      id,
      projectId: state.activeProjectId,
      title: d.title,
      goal: d.goal,
      priority: 'normal',
      state: 'QUEUED',
      overlays: [],
      dependsOn: [],
      manualOrder: 100 + i,
      budget: 3.0,
      cost: 0,
      tokens: 0,
      worktree: null,
      runs: [],
      activity: [{ at: nowLabel(), who: 'system', text: 'Planner 拆卡入场 → Backlog' }],
      criteria: (d.warn ? GENERIC_CRITERIA : d.criteria.map((t) => ({ text: t, status: 'pending', evidence: 'tests/*' }))),
      diff: GENERIC_DIFF,
      files: GENERIC_DIFF.map((f) => ({ path: f.path, flag: f.flag, add: f.add, del: f.del })),
      devSteps: GENERIC_DEV_STEPS.map((s) => ({ ...s })),
      devIdx: 0,
      fixSteps: [],
      fixIdx: 0,
      reviewFailsLeft: 0,
      rejects: 0,
      liveTail: '',
      helpQuestion: null,
      takeoverMessages: null,
      notified: false,
      createdAt: '刚刚',
      fresh: true,
      _draftRef: d.id,
      _depDraftRef: d.dependsOn,
    });
  });
  // 二次绑定依赖（入场后才有真实 id）
  state.cards.forEach((c) => {
    if (c._depDraftRef) {
      const dep = state.cards.find((x) => x._draftRef === c._depDraftRef);
      if (dep) c.dependsOn = [dep.id];
    }
  });
  state.split = null;
  toast('success', '📋 已入场', '依赖就绪的卡将立即自动流转');
  render();
  setTimeout(() => state.cards.forEach((c) => (c.fresh = false)), 600);
}

function cardIdSeed(draftRef) {
  return draftRef; // 仅用于可读性占位，真正绑定在 enterSplit 二次遍历
}

function createCardsFromText(text) {
  const id = `c-quick-${Date.now().toString(36)}`;
  state.cards.push({
    id,
    projectId: state.activeProjectId,
    title: text.length > 30 ? text.slice(0, 30) + '…' : text,
    goal: text,
    priority: 'normal',
    state: 'QUEUED',
    overlays: [],
    dependsOn: [],
    manualOrder: 99,
    budget: 3.0,
    cost: 0,
    tokens: 0,
    worktree: null,
    runs: [],
    activity: [{ at: nowLabel(), who: 'system', text: '⌘↵ 快速建卡 → Backlog' }],
    criteria: GENERIC_CRITERIA.map((c) => ({ ...c })),
    diff: GENERIC_DIFF,
    files: GENERIC_DIFF.map((f) => ({ path: f.path, flag: f.flag, add: f.add, del: f.del })),
    devSteps: GENERIC_DEV_STEPS.map((s) => ({ ...s })),
    devIdx: 0,
    fixSteps: [],
    fixIdx: 0,
    reviewFailsLeft: 0,
    rejects: 0,
    liveTail: '',
    helpQuestion: null,
    takeoverMessages: null,
    notified: false,
    createdAt: '刚刚',
    fresh: true,
  });
  setTimeout(() => {
    const c = state.cards.find((x) => x.id === id);
    if (c) c.fresh = false;
  }, 600);
}

/* ============ 收件箱条目跳转 ============ */
function handleInboxItem(itemId) {
  const item = state.inbox.find((i) => i.id === itemId);
  if (!item) return;
  item.unread = false;
  if (item.projectId !== state.activeProjectId) switchProject(item.projectId);
  if (item.type === 'AWAITING_ACCEPTANCE') {
    openAccept(item.cardId);
  } else {
    // 求助/失败/预算 → 卡片详情定位
    openDrawer(item.cardId, 'activity');
    if (item.type === 'FAILED') toast('warn', '失败卡片', '重试 / 改卡 / 取消？');
    if (item.type === 'BUDGET') toast('warn', '成本超限', '加预算或取消？');
  }
  state.inboxOpen = false;
  render();
}

/* ============ Backlog 拖拽排序 ============ */
let dragId = null;

function onDragStart(e) {
  const el = e.target.closest('[data-card-id]');
  if (!el) return;
  const card = state.cards.find((c) => c.id === el.dataset.cardId);
  if (!card || STATE_COLUMN[card.state] !== 'BACKLOG') {
    e.preventDefault();
    return;
  }
  dragId = card.id;
  el.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function onDragOver(e) {
  if (!dragId) return;
  const body = e.target.closest('[data-col-body]');
  document.querySelectorAll('[data-col-body]').forEach((b) => {
    b.classList.remove('drop-hint', 'col-cross-denied');
  });
  if (!body) return;
  e.preventDefault();
  if (body.dataset.colBody === 'BACKLOG') body.classList.add('drop-hint');
  else body.classList.add('col-cross-denied');
}

function onDrop(e) {
  if (!dragId) return;
  const body = e.target.closest('[data-col-body]');
  document.querySelectorAll('[data-col-body]').forEach((b) => b.classList.remove('drop-hint', 'col-cross-denied'));
  if (!body || body.dataset.colBody !== 'BACKLOG') {
    if (body) toast('warn', '🚫 禁止跨列拖动', '列流转由状态机驱动，Backlog 内只能排序');
    cleanupDrag();
    return;
  }
  // 计算插入位置：找目标卡
  const targetEl = e.target.closest('[data-card-id]');
  const backlog = state.cards
    .filter((c) => c.projectId === state.activeProjectId && STATE_COLUMN[c.state] === 'BACKLOG')
    .sort((a, b) => a.manualOrder - b.manualOrder);
  const dragged = state.cards.find((c) => c.id === dragId);
  if (!dragged) return cleanupDrag();
  const rest = backlog.filter((c) => c.id !== dragId);
  let idx = rest.length;
  if (targetEl && targetEl.dataset.cardId !== dragId) {
    idx = rest.findIndex((c) => c.id === targetEl.dataset.cardId);
    if (idx < 0) idx = rest.length;
  }
  rest.splice(idx, 0, dragged);
  rest.forEach((c, i) => (c.manualOrder = i));
  cleanupDrag();
  render();
}

function cleanupDrag() {
  dragId = null;
  document.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
  document.querySelectorAll('[data-col-body]').forEach((b) => b.classList.remove('drop-hint', 'col-cross-denied'));
}

/* ============ 演示模式 ============ */
function startDemo() {
  if (state.demo.active) return;
  state.demo.active = true;
  openTab({ id: 'board', kind: 'board', title: 'koda · 看板', closable: false });
  state.activeTabId = 'board';
  state.drawer.open = false;
  state.inboxOpen = false;
  render();
  toast('notify', '▶ 演示开始', '看一遍完整闭环：进料 → 自动执行 → 验收');

  const demoText = '给验收台加键盘快捷键，j/k 切换 a 通过 r 打回；再弹一个快捷键帮助面板';
  let i = 0;
  state.demo.typing = true;
  const typeTimer = setInterval(() => {
    i += 1;
    state.intakeDraft = demoText.slice(0, i);
    const input = $('intakeInput');
    if (input) input.value = state.intakeDraft;
    if (i >= demoText.length) {
      clearInterval(typeTimer);
      state.demo.typing = false;
      setTimeout(() => {
        submitIntake(false);
        sim.setTimeScale(5);
        watchDemo();
      }, 500);
    }
  }, 26);
}

function watchDemo() {
  const check = setInterval(() => {
    const reached = state.cards.some(
      (c) => c._draftRef && c.state === 'AWAITING_ACCEPTANCE'
    );
    if (reached || !state.demo.active) {
      clearInterval(check);
      sim.setTimeScale(1);
      state.demo.active = false;
      if (reached) {
        toast('notify', '🔔 演示：有卡待验收了', '点「进入验收台」，试试 j/k/a/r');
        document.querySelector('.col-accept-btn')?.classList.add('pulse');
      }
      render();
    }
  }, 500);
}

/* ============ 全局事件委托 ============ */
document.addEventListener('click', (e) => {
  const actEl = e.target.closest('[data-act]');
  if (!actEl) {
    // 点空白处关闭收件箱
    if (state.inboxOpen && !e.target.closest('.inbox-panel') && !e.target.closest('[data-act="inbox"]')) {
      state.inboxOpen = false;
      renderInbox(state);
      els.sidebar.innerHTML = renderSidebar(state);
    }
    return;
  }
  const act = actEl.dataset.act;
  const id = actEl.dataset.id;
  saveFocus();

  switch (act) {
    case 'project': switchProject(id); break;
    case 'add-project': toast('warn', 'v1 一看板一仓库', '多仓库在 v1.x'); break;
    case 'inbox':
      state.inboxOpen = !state.inboxOpen;
      renderInbox(state);
      els.sidebar.innerHTML = renderSidebar(state);
      break;
    case 'inbox-close':
      state.inboxOpen = false;
      renderInbox(state);
      els.sidebar.innerHTML = renderSidebar(state);
      break;
    case 'inbox-read-all':
      state.inbox.forEach((i) => (i.unread = false));
      renderInbox(state);
      els.sidebar.innerHTML = renderSidebar(state);
      break;
    case 'inbox-item': handleInboxItem(id); break;
    case 'settings':
      openTab({ id: 'settings', kind: 'settings', title: '设置', closable: true });
      state.activeTabId = 'settings';
      render();
      break;
    case 'tab': {
      state.activeTabId = id;
      state.drawer.open = false;
      const t = state.tabs.find((x) => x.id === id);
      if (t && t.kind === 'accept') {
        state.rejectOpen = false;
        if (!state.acceptSelectedId) {
          const aw = state.cards.filter(
            (c) => c.projectId === state.activeProjectId && c.state === 'AWAITING_ACCEPTANCE'
          );
          state.acceptSelectedId = aw[0]?.id || null;
        }
      }
      render();
      break;
    }
    case 'tab-close': closeTab(id); break;
    case 'accept': openAccept(); break;
    case 'accept-select':
      state.acceptSelectedId = id;
      state.rejectOpen = false;
      render();
      break;
    case 'accept-pass': passCard(id); break;
    case 'accept-reject':
      state.rejectOpen = true;
      render();
      requestAnimationFrame(() => $('rejectComment')?.focus());
      break;
    case 'reject-cancel':
      state.rejectOpen = false;
      render();
      break;
    case 'reject-confirm': {
      const comment = ($('rejectComment')?.value || '').trim() || 'UI 位置不对，按线框调整';
      rejectCard(id, comment);
      break;
    }
    case 'card': {
      if (dragId) break;
      openDrawer(id);
      break;
    }
    case 'drawer-close':
      state.drawer.open = false;
      renderDrawer(state);
      break;
    case 'drawer-tab':
      state.drawer.tab = actEl.dataset.tab;
      renderDrawer(state);
      break;
    case 'drawer-full':
      state.drawer.full = !state.drawer.full;
      renderDrawer(state);
      break;
    case 'takeover': takeover(id); break;
    case 'takeover-return':
      returnFromTakeover(id);
      closeTabSilent(`takeover-${id}`);
      render();
      break;
    case 'tk-send': tkSend(id); break;
    case 'card-pause': pauseCard(id); break;
    case 'card-cancel': cancelCard(id); state.drawer.open = false; render(); break;
    case 'help-reply': helpReply(id); break;
    case 'demo': startDemo(); break;
    case 'split-cancel':
      state.split = null;
      render();
      break;
    case 'split-enter': enterSplit(); break;
    case 'split-del':
      if (state.split) {
        state.split.drafts = state.split.drafts.filter((d) => d.id !== id);
        render();
      }
      break;
    case 'set-section':
      state.settings.section = id;
      render();
      break;
    case 'slots-dec':
      state.settings.slots = Math.max(1, state.settings.slots - 1);
      render();
      break;
    case 'slots-inc':
      state.settings.slots = Math.min(6, state.settings.slots + 1);
      render();
      break;
    case 'cap-dec':
      state.settings.dailyCap = Math.max(5, state.settings.dailyCap - 5);
      render();
      break;
    case 'cap-inc':
      state.settings.dailyCap += 5;
      render();
      break;
    case 'budget-dec':
      state.settings.defaultBudget = Math.max(1, state.settings.defaultBudget - 1);
      render();
      break;
    case 'budget-inc':
      state.settings.defaultBudget += 1;
      render();
      break;
    case 'watchdog':
      state.settings.watchdog = +actEl.dataset.v;
      render();
      break;
    case 'delivery':
      state.settings.deliveryMode = actEl.dataset.v;
      toast('success', 'deliveryMode', actEl.dataset.v);
      render();
      break;
    case 'notify-toggle':
      state.settings.notify = !state.settings.notify;
      render();
      break;
    case 'noop':
      e.preventDefault();
      toast('warn', '演示版', '原型中仅展示，不可操作');
      break;
    default:
      break;
  }
});

function closeTabSilent(id) {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const t = state.tabs[idx];
  if (!t.closable) return;
  state.tabs.splice(idx, 1);
  if (state.activeTabId === id) state.activeTabId = 'board';
}

/* 输入事件 */
document.addEventListener('input', (e) => {
  if (e.target.id === 'intakeInput') state.intakeDraft = e.target.value;
  if (e.target.classList?.contains('sc-title') && state.split) {
    const d = state.split.drafts.find((x) => x.id === e.target.dataset.id);
    if (d) d.title = e.target.value;
  }
});

/* 键盘 */
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  const inField = tag === 'INPUT' || tag === 'TEXTAREA';

  // ⌘↵ 快速建卡
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && document.activeElement?.id === 'intakeInput') {
    e.preventDefault();
    submitIntake(true);
    return;
  }
  // ↵ 进料
  if (e.key === 'Enter' && document.activeElement?.id === 'intakeInput' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    submitIntake(false);
    return;
  }
  // 接管输入回车发送
  if (e.key === 'Enter' && document.activeElement?.id === 'tkInput') {
    e.preventDefault();
    tkSend(document.activeElement.dataset.id);
    return;
  }
  // 求助回复回车
  if (e.key === 'Enter' && document.activeElement?.id === 'helpReplyInput') {
    e.preventDefault();
    const cardId = state.drawer.cardId;
    if (cardId) helpReply(cardId);
    return;
  }
  // 打回评语 ⌘↵ 提交
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && document.activeElement?.id === 'rejectComment') {
    e.preventDefault();
    const id = document.querySelector('[data-act="reject-confirm"]')?.dataset.id;
    if (id) rejectCard(id, ($('rejectComment')?.value || '').trim() || '按线框调整');
    return;
  }

  if (e.key === 'Escape') {
    if (state.rejectOpen) { state.rejectOpen = false; render(); return; }
    if (state.drawer.open) { state.drawer.open = false; renderDrawer(state); return; }
    if (state.inboxOpen) {
      state.inboxOpen = false;
      renderInbox(state);
      els.sidebar.innerHTML = renderSidebar(state);
      return;
    }
    return;
  }

  if (inField) return;

  // 验收台键盘流
  const tab = activeTab();
  if (tab?.kind === 'accept') {
    if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); acceptMove(1); }
    else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); acceptMove(-1); }
    else if (e.key === 'a') { e.preventDefault(); if (state.acceptSelectedId) passCard(state.acceptSelectedId); }
    else if (e.key === 'r') { e.preventDefault(); state.rejectOpen = true; render(); requestAnimationFrame(() => $('rejectComment')?.focus()); }
    else if (e.key === 't') { e.preventDefault(); if (state.acceptSelectedId) takeover(state.acceptSelectedId); }
    else if (e.key === 'd') { e.preventDefault(); toast('notify', '完整 Diff', '原型默认已展开全部文件'); }
  }
});

/* 拖拽 */
document.addEventListener('dragstart', onDragStart);
document.addEventListener('dragover', onDragOver);
document.addEventListener('drop', onDrop);
document.addEventListener('dragend', cleanupDrag);

/* ============ 模拟引擎接线 ============ */
const sim = new Sim(state, {
  onTick(structural) {
    if (structural) render(true);
    else patch();
  },
  onInbox() {
    // 铃铛摇一摇
    requestAnimationFrame(() => {
      const bell = $('bellIco');
      if (bell) {
        bell.classList.remove('bell-shake');
        void bell.offsetWidth;
        bell.classList.add('bell-shake');
      }
    });
  },
  onToast(kind, title, sub) {
    if (state.settings.notify || kind !== 'notify') toast(kind, title, sub);
  },
});

/* ============ 启动 ============ */
function nowLabel() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

render();
sim.start();

// 首屏提示
setTimeout(() => {
  toast('notify', '👋 这是 Koda 活原型', '卡片自己在跑——点右上角「60 秒演示」看完整闭环');
}, 900);
