import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EmptyState, ErrorState, Skeleton } from "../states";

describe("ui/EmptyState", () => {
  it("shows the title, reason and next step", () => {
    render(<EmptyState title="No cards" description="Nothing matches this filter" action={<button>Clear filter</button>} />);
    expect(screen.getByText("No cards")).toBeTruthy();
    expect(screen.getByText("Nothing matches this filter")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear filter" })).toBeTruthy();
  });

  it("falls back to the i18n default title", () => {
    render(<EmptyState />);
    expect(screen.getByTestId("ui-empty-state").textContent).toContain("Nothing here yet");
  });
});

describe("ui/Skeleton", () => {
  it("is a busy status region with the requested number of lines", () => {
    render(<Skeleton lines={4} />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.textContent).toContain("Loading");
    expect(status.querySelectorAll("[aria-hidden='true']")).toHaveLength(4);
  });
});

describe("ui/ErrorState", () => {
  it("shows the reason and calls onRetry when retry is clicked", () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Server returned 502" onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).toContain("Server returned 502");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("hides the retry button when no handler is given", () => {
    render(<ErrorState message="Gone" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
