import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRuntimeFitnessStatus } from "../use-runtime-fitness-status";

const { desktopAwareFetch } = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
}));

vi.mock("@/client/utils/diagnostics", async () => {
  const actual = await vi.importActual<typeof import("@/client/utils/diagnostics")>("@/client/utils/diagnostics");
  return {
    ...actual,
    desktopAwareFetch,
  };
});

function okJson(data: unknown) {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}

describe("useRuntimeFitnessStatus", () => {
  beforeEach(() => {
    desktopAwareFetch.mockReset();
  });

  it("fetches runtime fitness by codebaseId and exposes the payload", async () => {
    desktopAwareFetch.mockResolvedValue(okJson({
      generatedAt: "2026-04-15T00:00:00.000Z",
      repoRoot: "/tmp/repo",
      hasRunning: false,
      latest: null,
      modes: [],
    }));

    const { result } = renderHook(() => useRuntimeFitnessStatus({
      workspaceId: "workspace-1",
      codebaseId: "codebase-1",
      isPageVisible: false,
    }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.data?.repoRoot).toBe("/tmp/repo");
    });

    expect(desktopAwareFetch).toHaveBeenCalledWith(
      "/api/fitness/runtime?codebaseId=codebase-1",
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("falls back to the localized default error when the response has no details", async () => {
    desktopAwareFetch.mockResolvedValue({
      ok: false,
      json: async () => ({}),
    } as Response);

    const { result } = renderHook(() => useRuntimeFitnessStatus({
      workspaceId: "workspace-1",
      isPageVisible: false,
    }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe("Failed to load runtime fitness status");
    });
  });

  it("collapses a burst of refreshSignal changes into a single fetch", async () => {
    // refreshSignal changes on every kanban:changed event and on each step of
    // the post-action refresh burst. Without throttling, each one fired its
    // own request against a route that can take seconds to answer.
    desktopAwareFetch.mockResolvedValue(okJson({
      generatedAt: "2026-04-15T00:00:00.000Z",
      repoRoot: "/tmp/repo",
      hasRunning: false,
      latest: null,
      modes: [],
    }));

    const { rerender } = renderHook(
      ({ signal }: { signal: number }) => useRuntimeFitnessStatus({
        workspaceId: "workspace-1",
        codebaseId: "codebase-1",
        isPageVisible: false,
        refreshSignal: signal,
      }),
      { initialProps: { signal: 0 } },
    );

    await waitFor(() => expect(desktopAwareFetch).toHaveBeenCalledTimes(1));

    for (let signal = 1; signal <= 5; signal += 1) {
      rerender({ signal });
    }

    // The initial load is the only request that gets through; the burst is
    // coalesced behind the minimum interval.
    await waitFor(() => expect(desktopAwareFetch).toHaveBeenCalledTimes(1));
  });
});
