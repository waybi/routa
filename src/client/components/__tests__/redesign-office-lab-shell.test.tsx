import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import en from "@/i18n/locales/en";

vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="desktop-shell-root">{children}</div>
  ),
}));

vi.mock("@autodev/office-render", () => ({
  PRESENTATION_HEADER_ACTIONS_ID: "presentation-header-actions",
  PresentationPreview: () => null,
  SpreadsheetPreview: () => null,
  WordPreview: () => null,
}));

import { OfficeWasmPocPageClient } from "@/app/debug/office-wasm-poc/page-client";

describe("office lab page shell", () => {
  it("renders /debug/office-wasm-poc inside the app shell", () => {
    render(<OfficeWasmPocPageClient />);
    const shell = screen.getByTestId("desktop-shell-root");
    const pageHeaders = within(shell).getAllByTestId("settings-page-header");
    expect(pageHeaders).toHaveLength(1);
    expect(within(pageHeaders[0]).getByRole("heading", { level: 1 }).textContent).toBe(
      en.pagesRedesign.headers.officeLab.title,
    );
    expect(within(shell).getByTestId("office-wasm-reader-mode")).toBeTruthy();
  });
});
