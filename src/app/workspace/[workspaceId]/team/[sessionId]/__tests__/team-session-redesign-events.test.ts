import { describe, expect, it } from "vitest";

import { enTeamRedesign } from "@/i18n/locales/en-team-redesign";
import { zhTeamRedesign } from "@/i18n/locales/zh-team-redesign";
import type { SessionInfo } from "../../../types";
import { buildCoordinationEvents, type CoordinationInput } from "../team-run-events";

const zh = zhTeamRedesign.teamRedesign;
const en = enTeamRedesign.teamRedesign;

const ROOT: SessionInfo = { sessionId: "root-1", workspaceId: "default", cwd: "/repo", role: "ROUTA", createdAt: "2026-10-20T00:00:00.000Z" };
const QA_CHILD: SessionInfo = { sessionId: "child-qa", workspaceId: "default", cwd: "/repo", role: "GATE", specialistId: "team-qa", parentSessionId: "root-1", createdAt: "2026-10-20T01:00:00.000Z" };
const DEV_CHILD: SessionInfo = { sessionId: "child-dev", workspaceId: "default", cwd: "/repo", role: "CRAFTER", specialistId: "team-backend-dev", parentSessionId: "root-1", createdAt: "2026-10-20T02:00:00.000Z" };

function baseInput(): CoordinationInput {
  return {
    session: ROOT,
    sessionId: "root-1",
    rootHistory: [
      { sessionId: "root-1", update: { sessionUpdate: "user_message", content: { type: "text", text: "Fix the login bug" } } },
      { sessionId: "root-1", update: { sessionUpdate: "tool_call_update", title: "delegate_task", status: "completed", rawInput: { specialist: "team-qa", additionalInstructions: "Verify login" } } },
      { sessionId: "root-1", update: { sessionUpdate: "tool_call_update", title: "delegate_task", status: "failed", rawInput: { specialist: "team-backend-dev" } } },
      { sessionId: "root-1", update: { sessionUpdate: "tool_call_update", title: "create_agent", status: "completed", rawInput: { name: "dev-2", role: "CRAFTER" } } },
    ],
    notes: [{
      id: "spec-1", title: "Spec", content: "## Goal\nShip it", workspaceId: "default", metadata: { type: "spec" },
      createdAt: "2026-10-20T00:30:00.000Z", updatedAt: "2026-10-20T00:30:00.000Z",
    }],
    descendantSessions: [QA_CHILD, DEV_CHILD],
    historiesBySessionId: {
      "child-qa": [{ sessionId: "child-qa", update: { sessionUpdate: "task_completion", taskStatus: "WAITING_REVIEW", completionSummary: "Needs rework" } }],
      "child-dev": [
        { sessionId: "child-dev", update: { sessionUpdate: "task_completion", taskStatus: "BLOCKED", completionSummary: "Stuck" } },
        { sessionId: "child-dev", update: { sessionUpdate: "acp_status", status: "error", error: "boom" } },
      ],
    },
    leadName: "组长",
    actorOf: (child) => (child.sessionId === "child-qa" ? "QA" : "后端"),
    linkedSessionIdForRoster: (rosterId) => (rosterId === "team-qa" ? "child-qa" : undefined),
  };
}

describe("buildCoordinationEvents (AC10 events, AC12 titles)", () => {
  it("builds Chinese titles for every event kind, newest first", () => {
    const events = buildCoordinationEvents(baseInput(), zh);
    const titles = events.map((event) => event.title);
    expect(titles).toContain("设定目标");
    expect(titles).toContain("组长 制定了计划");
    expect(titles).toContain("派活给 Qa");
    expect(titles).toContain("派活给 Backend Dev 失败");
    expect(titles).toContain("新建队友 dev-2");
    expect(titles).toContain("为 QA 开了成员会话");
    expect(titles).toContain("QA 要求返工");
    expect(titles).toContain("后端 报告受阻");
    expect(titles).toContain("后端 运行出错");
    for (const title of titles) {
      expect(title).not.toMatch(/Task assigned to|Objective set|Dispatch failed|Created teammate|Opened session for|reported a blocker|hit a runtime error/);
    }
    const keys = events.map((event) => event.sortKey);
    expect([...keys].sort((a, b) => b - a)).toEqual(keys);
  });

  it("maps event types and member session links", () => {
    const events = buildCoordinationEvents(baseInput(), zh);
    const byTitle = (title: string) => events.find((event) => event.title === title)!;
    expect(byTitle("设定目标").type).toBe("plan");
    expect(byTitle("派活给 Qa").type).toBe("assign");
    expect(byTitle("派活给 Qa").sessionId).toBe("child-qa");
    expect(byTitle("派活给 Backend Dev 失败").type).toBe("blocked");
    expect(byTitle("派活给 Backend Dev 失败").sessionId).toBeUndefined();
    expect(byTitle("QA 要求返工").type).toBe("revision");
    expect(byTitle("后端 报告受阻").type).toBe("blocked");
    expect(byTitle("新建队友 dev-2").summary).toBe("dev-2 以 CRAFTER 身份加入");
  });

  it("uses the en dictionary in English", () => {
    const titles = buildCoordinationEvents(baseInput(), en).map((event) => event.title);
    expect(titles).toContain("Objective set");
    expect(titles).toContain("QA requested a revision");
  });

  it("returns nothing before the session metadata arrives", () => {
    expect(buildCoordinationEvents({ ...baseInput(), session: null }, zh)).toEqual([]);
  });
});
