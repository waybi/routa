import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge, StatusDot, TONES } from "../badge";

describe("ui/Badge and ui/StatusDot", () => {
  it("supports exactly the five spec tones", () => {
    expect([...TONES]).toEqual(["neutral", "info", "attention", "danger", "success"]);
  });

  it.each(TONES)("Badge renders the %s tone with its text", (tone) => {
    render(<Badge tone={tone}>{`badge-${tone}`}</Badge>);
    const badge = screen.getByText(`badge-${tone}`);
    expect(badge.dataset.tone).toBe(tone);
    expect(badge.textContent).toBe(`badge-${tone}`);
  });

  it.each(TONES)("StatusDot renders the %s tone with a visible label", (tone) => {
    const { container } = render(<StatusDot tone={tone} label={`dot-${tone}`} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.dataset.tone).toBe(tone);
    expect(screen.getByText(`dot-${tone}`)).toBeTruthy();
    expect(root.querySelector("[aria-hidden='true']")).not.toBeNull();
  });

  it("gives each tone a different color class", () => {
    const classes = TONES.map((tone) => {
      const { container, unmount } = render(<Badge tone={tone}>x</Badge>);
      const className = (container.firstElementChild as HTMLElement).className;
      unmount();
      return className;
    });
    expect(new Set(classes).size).toBe(TONES.length);
  });
});
