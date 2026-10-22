import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import en from "@/i18n/locales/en";

import { SessionDetailHeader } from "../[sessionId]/session-detail-header";

const copy = en.sessionsRedesign;

describe("SessionDetailHeader", () => {
  it("AC4: shows the title, the 8-char session ID, model and role badges", () => {
    render(
      <SessionDetailHeader
        eyebrow={copy.sessionDetailEyebrow}
        title="turnilo board Done lane pusher · Backlog Refiner"
        sessionId="ad3742a5-1111-2222"
        model="claude-opus-5-5"
        role="CRAFTER"
        provider="dsh"
      />,
    );

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("turnilo board Done lane pusher · Backlog Refiner");
    expect(screen.getByTitle("ad3742a5-1111-2222").textContent).toBe("ad3742a5");
    expect(screen.getByText("claude-opus-5-5")).toBeTruthy();
    expect(screen.getByText("CRAFTER")).toBeTruthy();
    expect(screen.getByText("dsh")).toBeTruthy();
  });

  it("AC4: says the model was not recorded instead of inventing one", () => {
    render(<SessionDetailHeader eyebrow="x" title="t" sessionId="12345678abc" />);
    expect(screen.getByText(copy.modelUnrecorded)).toBeTruthy();
  });
});
