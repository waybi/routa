import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { Tabs } from "../tabs";

function Harness({ initial = "a" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <Tabs
      label="Detail"
      value={value}
      onChange={setValue}
      items={[
        { id: "a", label: "Alpha", content: <p>alpha body</p> },
        { id: "b", label: "Beta", content: <p>beta body</p> },
        { id: "c", label: "Gamma", content: <p>gamma body</p>, disabled: true },
        { id: "d", label: "Delta", content: <p>delta body</p> },
      ]}
    />
  );
}

describe("ui/Tabs", () => {
  it("exposes tablist / tab / tabpanel roles wired together", () => {
    render(<Harness />);
    expect(screen.getByRole("tablist", { name: "Detail" })).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(tabs[0].id);
    expect(tabs[0].getAttribute("aria-controls")).toBe(panel.id);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[0].tabIndex).toBe(0);
    expect(tabs[1].tabIndex).toBe(-1);
  });

  it("moves with ArrowRight / ArrowLeft, skips disabled tabs and wraps", () => {
    render(<Harness />);
    const tablist = screen.getByRole("tablist");

    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Beta" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toBe("beta body");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Beta" }));

    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Delta" }).getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Alpha" }).getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Delta" }).getAttribute("aria-selected")).toBe("true");
  });
});
