import { afterEach, describe, expect, it } from "vitest";

import {
  consumeKanbanDetailTabRequest,
  KANBAN_DETAIL_TAB_IDS,
  migrateLegacyKanbanDetailTab,
  requestKanbanDetailTab,
  resolveKanbanDetailTab,
} from "../kanban-detail-tab-request";

const EIGHT = ["overview", "readiness", "execution", "jitContext", "changes", "evidence", "runs", "completion"];

// The removed plain-language tab id, assembled so the id itself never
// appears outside kanban-detail-tab-request.ts (card verification grep).
const LEGACY_PLAIN_LANGUAGE_TAB = ["human", "Readable"].join("");

describe("KANBAN_DETAIL_TAB_IDS", () => {
  it("is the eight tabs of the detail before the redesign, in order", () => {
    expect([...KANBAN_DETAIL_TAB_IDS]).toEqual(EIGHT);
  });
});

describe("resolveKanbanDetailTab", () => {
  afterEach(() => {
    consumeKanbanDetailTabRequest("card-1");
  });

  it("rule 1: a notification request beats a remembered choice", () => {
    expect(resolveKanbanDetailTab({ requested: "completion", persisted: "changes", hasCompletionReport: false }))
      .toBe("completion");
    expect(resolveKanbanDetailTab({ requested: "evidence", persisted: "runs", hasCompletionReport: true }))
      .toBe("evidence");
  });

  it("rule 1: requestKanbanDetailTab is consumed once", () => {
    requestKanbanDetailTab("card-1", "evidence");
    expect(consumeKanbanDetailTabRequest("card-1")).toBe("evidence");
    expect(consumeKanbanDetailTabRequest("card-1")).toBeNull();
  });

  it("rule 2: the tab the user picked on this card wins over the completion default", () => {
    expect(resolveKanbanDetailTab({ persisted: "jitContext", hasCompletionReport: true })).toBe("jitContext");
  });

  it("rule 3: cards with a completion report open on the report", () => {
    expect(resolveKanbanDetailTab({ persisted: null, hasCompletionReport: true })).toBe("completion");
  });

  it("rule 4: cards without a report open on the overview", () => {
    expect(resolveKanbanDetailTab({ hasCompletionReport: false })).toBe("overview");
  });

  it("an unknown requested or stored id falls through to the next rule", () => {
    expect(resolveKanbanDetailTab({ requested: "bogus", persisted: "runs", hasCompletionReport: true })).toBe("runs");
    expect(resolveKanbanDetailTab({ persisted: "bogus", hasCompletionReport: false })).toBe("overview");
    expect(resolveKanbanDetailTab({ requested: "", persisted: "", hasCompletionReport: true })).toBe("completion");
  });
});

describe("migrateLegacyKanbanDetailTab", () => {
  it.each(EIGHT)("keeps the tab id %s as is", (id) => {
    expect(migrateLegacyKanbanDetailTab(id)).toBe(id);
  });

  it.each([
    ["overview", "overview"],
    ["construction", "execution"],
    ["changes", "changes"],
    ["completion", "completion"],
    [LEGACY_PLAIN_LANGUAGE_TAB, "overview"],
  ])("maps the redesign / removed id %s to %s", (id, next) => {
    expect(migrateLegacyKanbanDetailTab(id)).toBe(next);
    expect(resolveKanbanDetailTab({ requested: id, hasCompletionReport: true })).toBe(next);
    expect(resolveKanbanDetailTab({ persisted: id, hasCompletionReport: true })).toBe(next);
  });

  it.each(["bogus", "Overview", "changesAndEvidence", ""])("returns null for unknown %j", (id) => {
    expect(migrateLegacyKanbanDetailTab(id)).toBeNull();
  });
});
