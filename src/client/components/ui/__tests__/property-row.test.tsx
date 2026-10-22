import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PropertyRow } from "../property-row";

describe("ui/PropertyRow", () => {
  it("renders the label as <dt> and the value as <dd>", () => {
    render(
      <dl>
        <PropertyRow label="Card">6d7995dc</PropertyRow>
      </dl>,
    );
    expect(screen.getByText("Card").tagName).toBe("DT");
    expect(screen.getByText("6d7995dc").tagName).toBe("DD");
  });

  it("uses the monospace face only when asked", () => {
    render(
      <dl>
        <PropertyRow label="Commit" mono>abc123</PropertyRow>
        <PropertyRow label="Lane">Dev</PropertyRow>
      </dl>,
    );
    expect(screen.getByText("abc123").className).toContain("font-mono");
    expect(screen.getByText("Dev").className).not.toContain("font-mono");
  });
});
