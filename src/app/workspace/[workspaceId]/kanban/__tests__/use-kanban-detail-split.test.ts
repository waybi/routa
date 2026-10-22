import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useKanbanDetailSplit } from "../use-kanban-detail-split";

const KEY = "routa:kanban-detail-split-ratio:v2";

describe("useKanbanDetailSplit", () => {
  afterEach(() => window.localStorage.removeItem(KEY));

  it("uses the default ratio (session column ~390px at 1440) when nothing is stored", () => {
    window.localStorage.removeItem(KEY);
    const { result } = renderHook(() => useKanbanDetailSplit());
    expect(result.current.detailSplitRatio).toBe(0.73);
  });

  it("keeps a stored ratio within bounds", () => {
    window.localStorage.setItem(KEY, "0.6");
    expect(renderHook(() => useKanbanDetailSplit()).result.current.detailSplitRatio).toBe(0.6);
    window.localStorage.setItem(KEY, "0.1");
    expect(renderHook(() => useKanbanDetailSplit()).result.current.detailSplitRatio).toBe(0.4);
  });
});
