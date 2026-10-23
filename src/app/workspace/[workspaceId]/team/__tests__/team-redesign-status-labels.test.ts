import { describe, expect, it } from "vitest";

import { enTeamRedesign } from "@/i18n/locales/en-team-redesign";
import { zhTeamRedesign } from "@/i18n/locales/zh-team-redesign";
import {
  ACP_STATUSES,
  AGENT_STATUSES,
  DELIVERABLE_LABELS,
  DELIVERABLE_STATUSES,
  EVENT_TYPES,
  MEMBER_STATUSES,
  TASK_STATUSES,
  TERMINAL_STATES,
  acpStatusLabel,
  agentStatusLabel,
  deliverableKindLabel,
  deliverableStatusLabel,
  eventTypeLabel,
  fillTemplate,
  laneLabel,
  LANE_LABEL_KEYS,
  memberStatusLabel,
  runStatusLabel,
  taskStatusLabel,
  terminalStateLabel,
} from "../team-status-labels";

const zh = zhTeamRedesign.teamRedesign;
const en = enTeamRedesign.teamRedesign;

const GROUPS = [
  { name: "agent", values: AGENT_STATUSES, fn: agentStatusLabel, enExpected: [en.status.agent.pending, en.status.agent.active, en.status.agent.completed, en.status.agent.error, en.status.agent.cancelled] },
  { name: "acp", values: ACP_STATUSES, fn: acpStatusLabel, enExpected: [en.status.acp.connecting, en.status.acp.ready, en.status.acp.error] },
  { name: "terminal", values: TERMINAL_STATES, fn: terminalStateLabel, enExpected: [en.status.terminal.completed, en.status.terminal.failed, en.status.terminal.timedOut] },
  { name: "member", values: MEMBER_STATUSES, fn: memberStatusLabel, enExpected: [en.status.member.idle, en.status.member.working, en.status.member.blocked, en.status.member.reviewing, en.status.member.done] },
  { name: "task", values: TASK_STATUSES, fn: taskStatusLabel, enExpected: [en.status.task.notStarted, en.status.task.inProgress, en.status.task.waitingReview, en.status.task.done, en.status.task.blocked] },
  { name: "deliverable", values: DELIVERABLE_STATUSES, fn: deliverableStatusLabel, enExpected: [en.status.deliverable.draft, en.status.deliverable.review, en.status.deliverable.approved] },
  { name: "deliverableLabel", values: DELIVERABLE_LABELS.slice(0, 5), fn: deliverableKindLabel, enExpected: [en.status.deliverableLabel.deliverable, en.status.deliverableLabel.findings, en.status.deliverableLabel.testReport, en.status.deliverableLabel.uiProposal, en.status.deliverableLabel.patch] },
  { name: "eventType", values: EVENT_TYPES, fn: eventTypeLabel, enExpected: [en.status.eventType.plan, en.status.eventType.assign, en.status.eventType.revision, en.status.eventType.finding, en.status.eventType.complete, en.status.eventType.blocked] },
] as const;

describe("team-status-labels (AC12)", () => {
  it("covers the 35 required raw values", () => {
    expect(GROUPS.reduce((sum, group) => sum + group.values.length, 0)).toBe(35);
  });

  for (const group of GROUPS) {
    it(`zh: every ${group.name} value has non-empty Chinese copy that is not the raw code`, () => {
      for (const raw of group.values) {
        const result = group.fn(zh, raw);
        expect(result.known, `${group.name}.${raw}`).toBe(true);
        expect(result.label, `${group.name}.${raw}`).toBeTruthy();
        expect(result.label.toLowerCase(), `${group.name}.${raw}`).not.toBe(String(raw).toLowerCase());
        expect(result.label, `${group.name}.${raw}`).not.toBe(zh.status.unknown);
        expect(/[\u4e00-\u9fff]/.test(result.label), `${group.name}.${raw} should be Chinese: ${result.label}`).toBe(true);
      }
    });

    it(`en: every ${group.name} value reads the matching enTeamRedesign entry`, () => {
      group.values.forEach((raw, index) => {
        expect(group.fn(en, raw).label).toBe(group.enExpected[index]);
      });
    });
  }

  it("the extra deliverable labels from the model are translated too", () => {
    for (const raw of DELIVERABLE_LABELS) {
      expect(deliverableKindLabel(zh, raw).known).toBe(true);
    }
  });

  it("unknown values return 未知状态 and keep the raw value for the title", () => {
    const fns = [agentStatusLabel, acpStatusLabel, terminalStateLabel, memberStatusLabel, taskStatusLabel, deliverableStatusLabel, deliverableKindLabel, eventTypeLabel];
    for (const fn of fns) {
      const result = fn(zh, "FOO");
      expect(result.label).toBe("未知状态");
      expect(result.known).toBe(false);
      expect(result.raw).toBe("FOO");
    }
  });

  it("run status prefers terminal state, then acp status, then 未记录", () => {
    expect(runStatusLabel(zh, { terminalState: "failed", acpStatus: "ready" }).label).toBe("失败");
    expect(runStatusLabel(zh, { acpStatus: "error" }).label).toBe("出错");
    expect(runStatusLabel(zh, {}).label).toBe("未记录");
    expect(runStatusLabel(zh, null).label).toBe("未记录");
  });

  it("lane labels are translated", () => {
    for (const key of LANE_LABEL_KEYS) {
      const label = laneLabel(zh, key);
      expect(/[\u4e00-\u9fff]/.test(label), `${key} -> ${label}`).toBe(true);
    }
  });

  it("fillTemplate fills placeholders and leaves unknown ones", () => {
    expect(fillTemplate("派活给 {target}", { target: "QA" })).toBe("派活给 QA");
    expect(fillTemplate("{actor} {missing}", { actor: "A" })).toBe("A {missing}");
  });
});
