import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hasSessionConfigPicker } from "../../components/session-config-selects";
import { CONFIG_OPTIONS_RETRY_DELAYS_MS, useSessionConfigOptions } from "../use-session-config-options";

vi.mock("@/client/utils/diagnostics", () => ({
  desktopAwareFetch: vi.fn(),
}));

import { desktopAwareFetch } from "@/client/utils/diagnostics";

const OPTIONS = [
  {
    id: "model",
    name: "Model",
    type: "select",
    currentValue: "[\"local-7357\",\"claude-opus-5-5\"]",
    options: [{ value: "[\"local-7357\",\"claude-opus-5-5\"]", name: "Claude Opus 5.5" }],
  },
  {
    id: "reasoning_effort",
    name: "Reasoning",
    type: "select",
    currentValue: "high",
    options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }],
  },
];

function respond(status: number, body: unknown = {}): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const MAX_REQUESTS = 1 + CONFIG_OPTIONS_RETRY_DELAYS_MS.length;
const TOTAL_WAIT_MS = CONFIG_OPTIONS_RETRY_DELAYS_MS.reduce((sum, ms) => sum + ms, 0);

async function flush(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function picker(result: { current: ReturnType<typeof useSessionConfigOptions> }) {
  // storedSessionModel is empty in the kanban side panel (fallbackModel undefined).
  return hasSessionConfigPicker({
    configOptions: result.current.configOptions,
    unavailable: result.current.unavailable,
    fallbackModel: undefined,
  });
}

describe("useSessionConfigOptions retry while the agent process starts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(desktopAwareFetch).mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([404, 502])("shows the capsule once a first %i is followed by 200", async (firstStatus) => {
    const fetchMock = vi.mocked(desktopAwareFetch);
    fetchMock
      .mockResolvedValueOnce(respond(firstStatus))
      .mockResolvedValue(respond(200, { configOptions: OPTIONS }));

    const { result } = renderHook(() => useSessionConfigOptions({ sessionId: "s-new" }));
    await flush(0);
    expect(picker(result)).toBe(false);
    expect(result.current.unavailable).toBe(true);

    await flush(CONFIG_OPTIONS_RETRY_DELAYS_MS[0]);
    expect(picker(result)).toBe(true);
    expect(result.current.unavailable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Success stops retrying.
    await flush(TOTAL_WAIT_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops after the retry budget when the session never comes up", async () => {
    const fetchMock = vi.mocked(desktopAwareFetch);
    fetchMock.mockResolvedValue(respond(404));

    const { result } = renderHook(() => useSessionConfigOptions({ sessionId: "s-dead" }));
    await flush(TOTAL_WAIT_MS + 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_REQUESTS);
    expect(MAX_REQUESTS).toBeLessThanOrEqual(7);
    expect(result.current.unavailable).toBe(true);
    expect(picker(result)).toBe(false);

    await flush(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_REQUESTS);
  });

  it("stops retrying the old session after a switch and ignores its late reply", async () => {
    const fetchMock = vi.mocked(desktopAwareFetch);
    let releaseOld: ((value: Response) => void) | undefined;
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("s-old")) {
        if (fetchMock.mock.calls.filter(([u]) => String(u).includes("s-old")).length === 1) return respond(404);
        return new Promise<Response>((resolve) => {
          releaseOld = resolve;
        });
      }
      return respond(404);
    });

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useSessionConfigOptions({ sessionId }),
      { initialProps: { sessionId: "s-old" } },
    );
    await flush(0);
    await flush(CONFIG_OPTIONS_RETRY_DELAYS_MS[0]); // second s-old request now pending
    const oldCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("s-old")).length;
    expect(oldCalls()).toBe(2);

    rerender({ sessionId: "s-other" });
    await flush(0);
    // The pending old reply lands after the switch: it must not reach the new session.
    await act(async () => {
      releaseOld?.(respond(200, { configOptions: OPTIONS }));
    });
    await flush(TOTAL_WAIT_MS + 10_000);
    expect(oldCalls()).toBe(2);
    expect(result.current.configOptions).toBeNull();
    expect(picker(result)).toBe(false);
  });

  it("stops retrying after unmount", async () => {
    const fetchMock = vi.mocked(desktopAwareFetch);
    fetchMock.mockResolvedValue(respond(404));
    const { unmount } = renderHook(() => useSessionConfigOptions({ sessionId: "s-gone" }));
    await flush(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    unmount();
    await flush(TOTAL_WAIT_MS + 10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the old single request when the first GET already succeeds (F2)", async () => {
    const fetchMock = vi.mocked(desktopAwareFetch);
    fetchMock.mockResolvedValue(respond(200, { configOptions: OPTIONS }));
    const { result } = renderHook(() => useSessionConfigOptions({ sessionId: "s-live" }));
    await flush(TOTAL_WAIT_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hasSessionConfigPicker({
      configOptions: result.current.configOptions,
      unavailable: result.current.unavailable,
      fallbackModel: "claude-opus-5-5",
    })).toBe(true);
  });
});
