import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useKanbanDetailSplit } from "../use-kanban-detail-split";

const KEY = "routa:kanban-detail-split-ratio:v3";
const OLD_KEY = "routa:kanban-detail-split-ratio:v2";

describe("useKanbanDetailSplit", () => {
  afterEach(() => {
    window.localStorage.removeItem(KEY);
    window.localStorage.removeItem(OLD_KEY);
  });

  it("uses the default ratio 0.58 (session column ~605px at 1440) when nothing is stored", () => {
    const { result } = renderHook(() => useKanbanDetailSplit());
    expect(result.current.detailSplitRatio).toBe(0.58);
    expect(window.localStorage.getItem(KEY)).toBe("0.58");
  });

  it("ignores the v2 key, where most browsers stored the old 0.73", () => {
    window.localStorage.setItem(OLD_KEY, "0.73");
    expect(renderHook(() => useKanbanDetailSplit()).result.current.detailSplitRatio).toBe(0.58);
  });

  it("keeps a stored v3 ratio within bounds (0.4–0.82)", () => {
    window.localStorage.setItem(KEY, "0.5");
    expect(renderHook(() => useKanbanDetailSplit()).result.current.detailSplitRatio).toBe(0.5);
    window.localStorage.setItem(KEY, "0.95");
    expect(renderHook(() => useKanbanDetailSplit()).result.current.detailSplitRatio).toBe(0.82);
    window.localStorage.setItem(KEY, "0.1");
    expect(renderHook(() => useKanbanDetailSplit()).result.current.detailSplitRatio).toBe(0.4);
  });

  it("writes a dragged ratio to v3 and reads it back after remount", () => {
    const container = document.createElement("div");
    container.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, height: 0, right: 1000, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
    const { result, unmount } = renderHook(() => useKanbanDetailSplit());
    result.current.detailSplitContainerRef.current = container;
    act(() => result.current.setIsDraggingDetailSplit(true));
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 650 }));
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(result.current.detailSplitRatio).toBeCloseTo(0.65);
    expect(window.localStorage.getItem(KEY)).toBe("0.65");
    unmount();
    expect(renderHook(() => useKanbanDetailSplit()).result.current.detailSplitRatio).toBeCloseTo(0.65);
  });
});
