import { afterEach, describe, expect, it } from "vitest";

import {
  consumeKanbanDetailTabRequest,
  migrateLegacyKanbanDetailTab,
  requestKanbanDetailTab,
  resolveKanbanDetailTab,
} from "../kanban-detail-tab-request";

describe("resolveKanbanDetailTab", () => {
  afterEach(() => {
    consumeKanbanDetailTabRequest("card-1");
  });

  it("rule 1: a notification request forces the completion tab over a remembered choice", () => {
    expect(resolveKanbanDetailTab({ requested: "completion", persisted: "changes", hasCompletionReport: false }))
      .toBe("completion");
  });

  it("rule 1: requestKanbanDetailTab is consumed once", () => {
    requestKanbanDetailTab("card-1", "completion");
    expect(consumeKanbanDetailTabRequest("card-1")).toBe("completion");
    expect(consumeKanbanDetailTabRequest("card-1")).toBeNull();
  });

  it("rule 2: the tab the user picked on this card wins over the completion default", () => {
    expect(resolveKanbanDetailTab({ persisted: "construction", hasCompletionReport: true })).toBe("construction");
  });

  it("rule 3: cards with a completion report open on the report", () => {
    expect(resolveKanbanDetailTab({ persisted: null, hasCompletionReport: true })).toBe("completion");
  });

  it("rule 4: cards without a report open on the overview", () => {
    expect(resolveKanbanDetailTab({ hasCompletionReport: false })).toBe("overview");
  });

  it("an unknown stored id falls through to the default", () => {
    expect(resolveKanbanDetailTab({ persisted: "bogus", hasCompletionReport: false })).toBe("overview");
  });
});

describe("migrateLegacyKanbanDetailTab", () => {
  it.each([
    ["humanReadable", "overview"],
    ["readiness", "overview"],
    ["execution", "construction"],
    ["jitContext", "construction"],
    ["runs", "construction"],
    ["evidence", "changes"],
  ])("maps legacy %s to %s", (legacy, next) => {
    expect(migrateLegacyKanbanDetailTab(legacy)).toBe(next);
    expect(resolveKanbanDetailTab({ persisted: legacy, hasCompletionReport: true })).toBe(next);
  });

  it.each(["overview", "construction", "changes", "completion"])("keeps the new id %s", (id) => {
    expect(migrateLegacyKanbanDetailTab(id)).toBe(id);
  });
});
