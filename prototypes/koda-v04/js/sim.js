/* Koda 活原型 v0.4 — 模拟引擎
 * 每张卡按 v0.3 状态机自动流转：
 * QUEUED →(依赖就绪+槽位)→ READY → RUNNING →(步骤耗尽)→ REVIEWING
 * REVIEWING →(通过)→ AWAITING_ACCEPTANCE ｜(不通过)→ FIXING → REVIEWING
 * 累计打回 ≥3 → 强制 HELP；人验收通过 → MERGING →(2 tick)→ DONE
 */
import { STATE_COLUMN } from './data.js';

const TICK_MS = 1600;
const DEV_MODELS = 'claude-sonnet';
const REVIEW_MODEL = 'claude-opus';

function nowLabel() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function randCost(min, max) {
  return +(min + Math.random() * (max - min)).toFixed(3);
}

export class Sim {
  constructor(state, hooks) {
    this.state = state;
    this.hooks = hooks; // { onStructural(), onInbox(item), onToast(kind,title,sub) }
    this.timer = null;
    this.timeScale = 1;
    this.mergeTimers = new Map();
  }

  start() {
    this.schedule();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  setTimeScale(scale) {
    this.timeScale = scale;
    if (this.timer) {
      clearTimeout(this.timer);
      this.schedule();
    }
  }

  schedule() {
    this.timer = setTimeout(() => {
      this.tick();
      this.schedule();
    }, TICK_MS / this.timeScale);
  }

  cards(projectId = this.state.activeProjectId) {
    return this.state.cards.filter((c) => c.projectId === projectId);
  }

  activeSlots() {
    return this.cards().filter(
      (c) =>
        ['READY', 'RUNNING', 'FIXING'].includes(c.state) &&
        !c.overlays.includes('PAUSED') &&
        !c.overlays.includes('HELP') &&
        !c.overlays.includes('FAILED') &&
        !c.overlays.includes('TAKEN_OVER')
    ).length;
  }

  depsDone(card) {
    if (!card.dependsOn.length) return true;
    return card.dependsOn.every((depId) => {
      const dep = this.state.cards.find((c) => c.id === depId);
      return dep && dep.state === 'DONE';
    });
  }

  depsFailed(card) {
    return card.dependsOn.some((depId) => {
      const dep = this.state.cards.find((c) => c.id === depId);
      return dep && ['FAILED'].includes(dep.state) || (dep && dep.overlays.includes('FAILED'));
    });
  }

  pushInbox(type, card) {
    const item = {
      id: `ib-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      projectId: card.projectId,
      cardId: card.id,
      title: card.title,
      time: '刚刚',
      unread: true,
      done: false,
      isNew: true,
    };
    this.state.inbox.unshift(item);
    this.hooks.onInbox(item);
  }

  act(card, who, text) {
    card.activity.unshift({ at: nowLabel(), who, text });
    if (card.activity.length > 40) card.activity.pop();
  }

  newRun(card, kind, model) {
    const n = card.runs.filter((r) => r.kind === kind).length + 1;
    card.runs.push({ kind, model, cost: 0, state: 'going', tokens: 0, n });
    return card.runs[card.runs.length - 1];
  }

  tick() {
    if (this.state.demo.typing) return; // 演示打字期间冻结盘面
    let structural = false;

    for (const card of this.state.cards) {
      if (card.projectId !== this.state.activeProjectId) continue;
      if (card.overlays.includes('TAKEN_OVER')) continue;
      if (card.overlays.includes('PAUSED') || card.overlays.includes('FAILED')) continue;
      if (card.overlays.includes('HELP')) continue;

      switch (card.state) {
        case 'QUEUED': {
          if (this.depsFailed(card)) {
            card.state = 'BLOCKED';
            this.act(card, 'system', '依赖卡 FAILED → 本卡 BLOCKED，等待裁决');
            this.pushInbox('FAILED', card);
            structural = true;
            break;
          }
          if (this.depsDone(card) && this.activeSlots() < this.state.settings.slots) {
            card.state = 'READY';
            card.worktree = `wt/${card.id}`;
            this.act(card, 'system', `调度：依赖就绪 + 槽位空闲 → READY，创建 worktree ${card.worktree}`);
            structural = true;
          }
          break;
        }
        case 'READY': {
          card.state = 'RUNNING';
          const r = this.newRun(card, 'develop', DEV_MODELS);
          this.act(card, 'system', `派发 developer · Run #${r.n} (develop, ${DEV_MODELS})`);
          if (!card.devSteps.length) card.devSteps = [];
          card.devIdx = 0;
          if (card.devSteps[0]) card.liveTail = card.devSteps[0].tail;
          structural = true;
          break;
        }
        case 'RUNNING': {
          const step = card.devSteps[card.devIdx];
          if (!step) {
            // 无脚本（兜底）→ 直接进审查
            this.enterReview(card);
            structural = true;
            break;
          }
          step.ticks -= 1;
          const lastRun = card.runs[card.runs.length - 1];
          const dc = randCost(0.02, 0.07);
          card.cost = +(card.cost + dc).toFixed(2);
          card.tokens += Math.round(800 + Math.random() * 2400);
          if (lastRun) {
            lastRun.cost = +(lastRun.cost + dc).toFixed(2);
            lastRun.tokens += Math.round(800 + Math.random() * 2400);
          }
          if (step.ticks <= 0) {
            card.devIdx += 1;
            const next = card.devSteps[card.devIdx];
            if (next) {
              card.liveTail = next.tail;
            } else {
              this.act(card, 'dev', '宣告完成');
              this.enterReview(card);
              structural = true;
            }
          }
          break;
        }
        case 'REVIEWING': {
          const pending = card.criteria.filter((c) => c.status === 'pending');
          const lastRun = card.runs[card.runs.length - 1];
          if (lastRun) lastRun.cost = +(lastRun.cost + randCost(0.01, 0.03)).toFixed(2);
          card.cost = +(card.cost + randCost(0.01, 0.03)).toFixed(2);
          if (pending.length > 0) {
            pending[0].status = 'pass';
            const done = card.criteria.filter((c) => c.status !== 'pending').length;
            card.liveTail = `🔍 审查员核查中: ${done}/${card.criteria.length} 项…`;
            break;
          }
          // 全部核查完
          if (card.reviewFailsLeft > 0) {
            card.reviewFailsLeft -= 1;
            card.rejects += 1;
            if (card.rejects >= 3) {
              card.overlays = [...card.overlays, 'HELP'];
              card.helpQuestion = {
                text: '审查已连续打回 3 次，自动循环已停止。需要人裁决：调整验收标准 / 接管 / 取消。',
                askedAt: nowLabel(),
              };
              card.liveTail = '🆘 打回 ≥3 次，强制升级求助';
              this.act(card, 'review', '第 3 次打回 → 防死循环规则触发，强制 HELP');
              this.pushInbox('HELP', card);
            } else {
              const comment =
                card.rejects === 1
                  ? '审查不通过：边界场景缺少测试覆盖'
                  : '审查不通过：与验收标准第 2 条不符';
              card.state = 'FIXING';
              card.liveTail = '🔧 按审查意见修复中…';
              const r = this.newRun(card, 'fix', DEV_MODELS);
              this.act(card, 'review', `${comment}（第 ${card.rejects} 次打回，不惊动人）`);
              this.act(card, 'system', `自动打回 FIXING · Run #${r.n} (fix)`);
              card.fixSteps = [
                { tail: '定位审查指出的问题…', ticks: 2 },
                { tail: '应用修复并重跑测试: 通过 ✓', ticks: 2 },
              ];
              card.fixIdx = 0;
            }
            structural = true;
          } else {
            card.state = 'AWAITING_ACCEPTANCE';
            card.liveTail = '✓ 审查通过，等你验收';
            if (lastRun) lastRun.state = 'ok';
            this.act(card, 'review', '审查通过');
            this.act(card, 'system', '进入待验收 · 已发送桌面通知');
            if (!card.notified) {
              card.notified = true;
              this.pushInbox('AWAITING_ACCEPTANCE', card);
              this.hooks.onToast(
                'notify',
                '🔔 桌面通知 · 1 张卡待验收',
                card.title
              );
            }
            structural = true;
          }
          break;
        }
        case 'FIXING': {
          const step = card.fixSteps[card.fixIdx];
          if (!step) {
            card.criteria.forEach((c) => {
              if (c.status === 'fail') c.status = 'pending';
            });
            this.enterReview(card);
            structural = true;
            break;
          }
          step.ticks -= 1;
          card.cost = +(card.cost + randCost(0.02, 0.05)).toFixed(2);
          const lastRun = card.runs[card.runs.length - 1];
          if (lastRun) lastRun.cost = +(lastRun.cost + randCost(0.02, 0.05)).toFixed(2);
          if (step.ticks <= 0) {
            card.fixIdx += 1;
            const next = card.fixSteps[card.fixIdx];
            if (next) {
              card.liveTail = `🔧 ${next.tail}`;
            } else {
              card.criteria.forEach((c) => {
                if (c.status === 'fail') c.status = 'pending';
              });
              this.act(card, 'dev', '修复完成，重新提交审查');
              this.enterReview(card);
              structural = true;
            }
          }
          break;
        }
        case 'MERGING': {
          if (!this.mergeTimers.has(card.id)) {
            this.mergeTimers.set(card.id, 2);
          }
          let left = this.mergeTimers.get(card.id) - 1;
          this.mergeTimers.set(card.id, left);
          if (left <= 0) {
            this.mergeTimers.delete(card.id);
            card.state = 'DONE';
            card.liveTail = '';
            card.worktree = null;
            card.runs.push({ kind: 'merge', model: 'system', cost: 0, state: 'ok', tokens: 0 });
            this.act(card, 'system', '验收通过 → squash 合并回 main · worktree 已清理');
            this.hooks.onToast('success', '✓ 已合并', `${card.title} → main`);
            structural = true;
          }
          break;
        }
        default:
          break;
      }
    }

    // 今日成本累计
    const running = this.cards().some((c) =>
      ['RUNNING', 'FIXING', 'REVIEWING'].includes(c.state)
    );
    if (running) {
      this.state.stats.todayCost = +(this.state.stats.todayCost + randCost(0.01, 0.04)).toFixed(2);
    }

    this.hooks.onTick(structural);
  }

  enterReview(card) {
    card.state = 'REVIEWING';
    const r = this.newRun(card, 'review', REVIEW_MODEL);
    this.act(card, 'system', `派发 reviewer · Run #${r.n} (review, ${REVIEW_MODEL})`);
    card.liveTail = `🔍 审查员核查中: 0/${card.criteria.length} 项…`;
    card.criteria.forEach((c) => {
      if (c.status === 'pass') c.status = 'pending';
    });
  }

  /* 人触发的合并（验收通过） */
  startMerge(card) {
    card.state = 'MERGING';
    card.liveTail = '⚙ 合并中: rebase onto main…';
    this.act(card, 'system', '验收通过 → MERGING（deliveryMode: auto-merge squash）');
  }

  columnOf(card) {
    return STATE_COLUMN[card.state];
  }
}
