import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KanbanModelTiersCard } from "../kanban-model-tiers-card";
import { resetKanbanModelTiersCache } from "../../kanban-model-tiers/use-kanban-model-tiers";
import { resetModelEffortChoicesCache } from "../../model-effort/use-model-effort-choices";

const mv = (provider: string, model: string) => JSON.stringify([provider, model]);
const configOptions = {
  configOptions: [{
    id: "model",
    currentValue: mv("local-7357", "claude-opus-5-5"),
    options: [
      { group: "deepseek-official", name: "DeepSeek", options: [{ value: mv("deepseek-official", "deepseek-flash"), name: "DeepSeek Flash" }] },
      {
        group: "local-7357",
        name: "Local 7357",
        options: [
          { value: mv("local-7357", "claude-opus-5-5"), name: "Claude Opus 5.5" },
          { value: mv("local-7357", "claude-sonnet-5-5"), name: "Claude Sonnet 5.5" },
        ],
      },
    ],
  }],
};
const tiers = (smart: string | null) => ({
  providerId: "dsh",
  tiers: {
    fast: { override: null, codeDefault: "claude-opus-5-5", effective: "claude-opus-5-5" },
    balanced: { override: null, codeDefault: "claude-opus-5-5", effective: "claude-opus-5-5" },
    smart: { override: smart, codeDefault: "claude-opus-5-5", effective: smart ?? "claude-opus-5-5" },
  },
  specialists: [
    { id: "kanban-dev-executor", name: "Dev Crafter", tier: "smart" },
    { id: "kanban-review-guard", name: "Review Guard", tier: "smart" },
    { id: "issue-enricher", name: "Issue Enricher", tier: "smart" },
    { id: "kanban-done-reporter", name: "Done Reporter", tier: "balanced" },
  ],
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

describe("KanbanModelTiersCard", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetKanbanModelTiersCache();
    resetModelEffortChoicesCache();
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/providers/dsh/config-options")) return json(configOptions);
      if (url.includes("/kanban/model-tiers")) {
        if (init?.method === "PUT") {
          const body = JSON.parse(String(init.body)) as { smart?: string | null };
          return json(tiers(body.smart ?? null));
        }
        return json(tiers(null));
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers follow-code-default first and only Local 7357 models", async () => {
    render(<KanbanModelTiersCard />);
    const select = await screen.findByTestId("kanban-model-tier-smart-select") as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(3));
    expect(select.options[0]).toMatchObject({ value: "" });
    expect(select.options[0].textContent).toContain("claude-opus-5-5");
    expect(Array.from(select.options).map((option) => option.value)).toEqual(["", "claude-opus-5-5", "claude-sonnet-5-5"]);
  });

  it("explains on hover which Kanban specialists use each tier", async () => {
    render(<KanbanModelTiersCard />);
    await waitFor(() => expect(screen.getByTestId("kanban-model-tier-smart").getAttribute("title")).toContain("Dev Crafter"));
    const smartTitle = screen.getByTestId("kanban-model-tier-smart").getAttribute("title")!;
    expect(smartTitle).toContain("Review Guard");
    expect(smartTitle).not.toContain("Issue Enricher");
    expect(smartTitle).toContain("1");
    expect(screen.getByTestId("kanban-model-tier-balanced").getAttribute("title")).toContain("Done Reporter");
    expect(screen.getByTestId("kanban-model-tier-fast").getAttribute("title")).toMatch(/No specialist|没有岗位/);
  });

  it("saves a tier on the server and back to follow-code-default", async () => {
    render(<KanbanModelTiersCard />);
    const select = await screen.findByTestId("kanban-model-tier-smart-select") as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(3));

    fireEvent.change(select, { target: { value: "claude-sonnet-5-5" } });
    await waitFor(() => expect(screen.getByTestId("kanban-model-tier-smart").textContent).toContain("claude-sonnet-5-5"));
    const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
    expect(JSON.parse(String((put![1] as RequestInit).body))).toEqual({ smart: "claude-sonnet-5-5" });
    expect(select.value).toBe("claude-sonnet-5-5");

    fireEvent.change(select, { target: { value: "" } });
    await waitFor(() => expect(select.value).toBe(""));
    const puts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
    expect(JSON.parse(String((puts.at(-1)![1] as RequestInit).body))).toEqual({ smart: null });
  });
});
