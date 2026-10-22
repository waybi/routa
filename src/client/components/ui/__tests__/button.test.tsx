import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "../button";

describe("ui/Button", () => {
  it.each([
    ["primary", "bg-accent"],
    ["secondary", "bg-surface"],
    ["danger", "text-danger"],
    ["ghost", "bg-transparent"],
  ] as const)("renders the %s variant with token classes", (variant, expectedClass) => {
    render(<Button variant={variant}>{variant}</Button>);
    const button = screen.getByRole("button", { name: variant });
    expect(button.dataset.variant).toBe(variant);
    expect(button.className).toContain(expectedClass);
    expect(button.className).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("maps legacy desktop variants onto the new ones", () => {
    render(
      <>
        <Button variant="desktop-secondary">a</Button>
        <Button variant="desktop-accent">b</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "a" }).dataset.variant).toBe("secondary");
    expect(screen.getByRole("button", { name: "b" }).dataset.variant).toBe("primary");
  });

  it("is disabled and ignores clicks when disabled or loading", () => {
    const onClick = vi.fn();
    render(
      <>
        <Button disabled onClick={onClick}>off</Button>
        <Button loading onClick={onClick}>busy</Button>
      </>,
    );
    const off = screen.getByRole("button", { name: "off" }) as HTMLButtonElement;
    const busy = screen.getByRole("button", { name: "busy" }) as HTMLButtonElement;
    expect(off.disabled).toBe(true);
    expect(busy.disabled).toBe(true);
    fireEvent.click(off);
    fireEvent.click(busy);
    expect(onClick).not.toHaveBeenCalled();
  });
});
