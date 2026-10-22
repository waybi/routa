import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "../button";

describe("Button", () => {
  it("uses semantic danger tokens for the danger variant", () => {
    render(<Button variant="danger">Delete</Button>);

    const button = screen.getByRole("button", { name: "Delete" });
    const className = button.className;

    // Redesign tokens (design-spec §2): text-danger / bg-danger-subtle.
    expect(className).toContain("text-danger");
    expect(className).toContain("border-danger");
    expect(className).toContain("hover:bg-danger-subtle");
    expect(className).not.toMatch(/\bbg-red-\d+\b/);
    expect(className).not.toMatch(/\btext-red-\d+\b/);
    expect(className).not.toMatch(/\bfocus:ring-red-\d+\b/);
  });
});
