import { render, screen, within } from "@testing-library/react";
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

  it("is one row on wide screens: title truncates with the full text on hover, badges and actions on the same line", () => {
    const longTitle = "看板任务代理侧栏输入框被裁：小尺寸工具条改成自适应换行 · Dev Crafter · a very long tail that must truncate";
    render(
      <SessionDetailHeader
        eyebrow={copy.sessionDetailEyebrow}
        title={longTitle}
        sessionId="ad3742a5-1111-2222"
        model="claude-opus-5-5"
        role="CRAFTER"
        provider="dsh"
        actions={<button type="button">Go to board</button>}
      />,
    );

    const header = screen.getByTestId("session-detail-header");
    expect(header.className).toContain("flex");
    expect(header.className).toContain("xl:flex-nowrap");
    expect(header.className).toContain("items-center");

    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.className).toContain("truncate");
    expect(h1.className).toContain("text-[15px]");
    expect(h1.getAttribute("title")).toBe(longTitle);

    // Eyebrow, title, badges and actions are all direct parts of the one header row.
    const titleGroup = screen.getByTestId("session-detail-title-group");
    const badges = screen.getByTestId("session-detail-badges");
    const actions = screen.getByTestId("session-detail-actions");
    for (const part of [titleGroup, badges, actions]) expect(part.parentElement).toBe(header);
    expect(within(titleGroup).getByText(copy.sessionDetailEyebrow)).toBeTruthy();
    expect(within(badges).getByTitle("ad3742a5-1111-2222")).toBeTruthy();
    expect(within(badges).getByText("CRAFTER")).toBeTruthy();
    expect(within(badges).getByText("dsh")).toBeTruthy();
    expect(within(actions).getByRole("button", { name: "Go to board" })).toBeTruthy();
  });
});
