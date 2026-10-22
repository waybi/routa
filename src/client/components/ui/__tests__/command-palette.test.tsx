import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const routerState = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerState.push }),
}));

import { CommandPalette } from "../command-palette";

beforeAll(() => {
  // jsdom lacks the modal dialog API.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

beforeEach(() => {
  routerState.push.mockReset();
});

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <input aria-label="board search" />
      <button type="button">before</button>
      <CommandPalette workspaceId="ws-1" open={open} onOpenChange={setOpen} />
    </>
  );
}

function pressShortcut(target: Element | Window, init: KeyboardEventInit = { metaKey: true }) {
  act(() => {
    fireEvent.keyDown(target, { key: "k", ...init });
  });
}

function dialog() {
  return screen.getByTestId("command-palette") as HTMLDialogElement;
}

describe("CommandPalette", () => {
  it("opens with ⌘K and Ctrl+K, even while focus is inside an input", () => {
    render(<Harness />);
    const input = screen.getByLabelText("board search");
    input.focus();

    pressShortcut(input);
    expect(dialog().open).toBe(true);
    expect(document.activeElement?.getAttribute("role")).toBe("combobox");

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(dialog().open).toBe(false);

    pressShortcut(window, { ctrlKey: true });
    expect(dialog().open).toBe(true);
  });

  it("is a native <dialog>", () => {
    render(<Harness />);
    expect(dialog().tagName).toBe("DIALOG");
  });

  it("lists every route and filters as you type, with an empty state", () => {
    render(<Harness />);
    pressShortcut(window);

    expect(screen.getAllByRole("option")).toHaveLength(29);

    const box = screen.getByRole("combobox");
    fireEvent.change(box, { target: { value: "board" } });
    expect(screen.getAllByRole("option").map((option) => option.dataset.href)).toContain("/workspace/ws-1/kanban");

    fireEvent.change(box, { target: { value: "zzz-nothing" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByTestId("command-palette-empty").textContent).toBe("No matching page. Try another word.");
  });

  it("moves with ↑/↓ and navigates on Enter", () => {
    render(<Harness />);
    pressShortcut(window);
    const box = screen.getByRole("combobox");

    const options = () => screen.getAllByRole("option");
    expect(options()[0].getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(options()[1].getAttribute("aria-selected")).toBe("true");
    expect(box.getAttribute("aria-activedescendant")).toBe(options()[1].id);

    fireEvent.keyDown(box, { key: "ArrowUp" });
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(options()[28].getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    const expectedHref = options()[1].dataset.href;
    fireEvent.keyDown(box, { key: "Enter" });

    expect(routerState.push).toHaveBeenCalledWith(expectedHref);
    expect(dialog().open).toBe(false);
  });

  it("closes on Esc and returns focus to the element focused before opening", () => {
    render(<Harness />);
    const before = screen.getByRole("button", { name: "before" });
    before.focus();

    pressShortcut(before);
    expect(document.activeElement).not.toBe(before);

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(dialog().open).toBe(false);
    expect(document.activeElement).toBe(before);
  });

  it("closes on the native cancel event and restores focus", () => {
    render(<Harness />);
    const before = screen.getByRole("button", { name: "before" });
    before.focus();
    pressShortcut(before);

    fireEvent(dialog(), new Event("cancel", { cancelable: true }));
    expect(dialog().open).toBe(false);
    expect(document.activeElement).toBe(before);
  });
});
