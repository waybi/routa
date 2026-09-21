import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConfirmDialogProvider, useConfirm } from "../confirm-dialog";

/** Exposes the hook's confirm() to the test body. */
function Harness({ onReady }: { onReady: (confirm: ReturnType<typeof useConfirm>) => void }) {
  const confirm = useConfirm();
  onReady(confirm);
  return <div>app</div>;
}

function renderWithProvider() {
  let confirmFn: ReturnType<typeof useConfirm> | null = null;
  render(
    <ConfirmDialogProvider>
      <Harness onReady={(fn) => { confirmFn = fn; }} />
    </ConfirmDialogProvider>,
  );
  return () => confirmFn!;
}

describe("ConfirmDialogProvider", () => {
  it("resolves true when the user confirms", async () => {
    const getConfirm = renderWithProvider();

    let resolved: boolean | undefined;
    act(() => {
      void getConfirm()({ message: "Discard changes?" }).then((value) => { resolved = value; });
    });

    expect(await screen.findByText("Discard changes?")).toBeTruthy();

    act(() => {
      screen.getByTestId("confirm-dialog-confirm").click();
    });

    await waitFor(() => expect(resolved).toBe(true));
    // Dialog closes once settled.
    expect(screen.queryByTestId("confirm-dialog")).toBeNull();
  });

  it("resolves false when the user cancels", async () => {
    const getConfirm = renderWithProvider();

    let resolved: boolean | undefined;
    act(() => {
      void getConfirm()({ message: "Reset branch?" }).then((value) => { resolved = value; });
    });

    expect(await screen.findByText("Reset branch?")).toBeTruthy();

    act(() => {
      screen.getByTestId("confirm-dialog-cancel").click();
    });

    await waitFor(() => expect(resolved).toBe(false));
  });

  it("renders an optional title and custom labels", async () => {
    const getConfirm = renderWithProvider();

    act(() => {
      void getConfirm()({
        title: "Clean up worktree?",
        message: "This removes the attached worktree.",
        confirmLabel: "Clean up",
        cancelLabel: "Keep it",
      });
    });

    expect(await screen.findByText("Clean up worktree?")).toBeTruthy();
    expect(screen.getByTestId("confirm-dialog-confirm").textContent).toBe("Clean up");
    expect(screen.getByTestId("confirm-dialog-cancel").textContent).toBe("Keep it");
  });

  it("cancels an open request when a second one arrives", async () => {
    const getConfirm = renderWithProvider();

    let first: boolean | undefined;
    let second: boolean | undefined;
    act(() => {
      void getConfirm()({ message: "first question" }).then((value) => { first = value; });
    });
    act(() => {
      void getConfirm()({ message: "second question" }).then((value) => { second = value; });
    });

    // The superseded promise must settle rather than hang forever.
    await waitFor(() => expect(first).toBe(false));
    expect(await screen.findByText("second question")).toBeTruthy();

    act(() => {
      screen.getByTestId("confirm-dialog-confirm").click();
    });
    await waitFor(() => expect(second).toBe(true));
  });

  it("renders nothing until a confirmation is requested", () => {
    renderWithProvider();
    expect(screen.queryByTestId("confirm-dialog")).toBeNull();
  });

  it("falls back to auto-confirm when no provider is mounted", async () => {
    let confirmFn: ReturnType<typeof useConfirm> | null = null;
    render(<Harness onReady={(fn) => { confirmFn = fn; }} />);

    // Without a provider the action must not be silently blocked.
    await expect(confirmFn!({ message: "orphan" })).resolves.toBe(true);
  });
});
