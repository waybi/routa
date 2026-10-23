import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TiptapInput } from "../tiptap-input";

vi.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: {
      chatPanel: {
        fileHint: "file",
        agentHint: "agent",
        skillHint: "skill",
        noResults: "No results",
        cloneRepoFirst: "Clone a repository first",
        selectModel: "Select model",
        defaultModel: "Default model",
        filterModels: "Filter models",
        noModelsFound: "No models found",
        brave: "Brave",
        plan: "Plan",
        build: "Build",
        inputLabel: "Input",
        outputLabel: "Output",
        tokens: "tokens",
      },
      common: {
        send: "Send",
        stop: "Stop",
      },
      sessionDetailRedesign: {
        composer: { placeholder: "Dictionary placeholder" },
      },
    },
  }),
}));

vi.mock("../repo-picker", () => ({
  RepoPicker: () => <div data-testid="repo-picker" />,
}));

vi.mock("../acp-provider-dropdown", () => ({
  AcpProviderDropdown: () => <div data-testid="provider-dropdown" />,
}));

vi.mock("../utils/diagnostics", () => ({
  desktopAwareFetch: vi.fn(),
}));

vi.mock("../utils/theme", () => ({
  isDarkThemeActive: () => false,
}));

describe("TiptapInput paste handling", () => {
  it("inserts pasted images into the editor without triggering send", async () => {
    const onSend = vi.fn();

    class MockFileReader {
      public onload: ((event: { target: { result: string } }) => void) | null = null;

      readAsDataURL() {
        this.onload?.({ target: { result: "data:image/png;base64,ZmFrZQ==" } });
      }
    }

    vi.stubGlobal("FileReader", MockFileReader);

    render(
      <TiptapInput
        onSend={onSend}
        selectedProvider="claude"
        onRepoChange={vi.fn()}
        repoSelection={null}
      />,
    );

    const editor = screen.getByRole("textbox");
    const imageFile = new File(["fake"], "paste.png", { type: "image/png" });
    const getAsFile = vi.fn(() => imageFile);

    fireEvent.paste(editor, {
      clipboardData: {
        items: [{ type: "image/png", getAsFile }],
        files: [imageFile],
        types: ["Files"],
        getData: vi.fn(() => ""),
      },
    });

    await waitFor(() => {
      expect(document.querySelector("img[src=\"data:image/png;base64,ZmFrZQ==\"]")).toBeTruthy();
    });

    expect(getAsFile).toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

describe("TiptapInput legacy model picker", () => {
  function renderWith(hideLegacyModelPicker?: boolean) {
    return render(
      <TiptapInput
        onSend={vi.fn()}
        selectedProvider="opencode"
        onRepoChange={vi.fn()}
        repoSelection={null}
        onFetchModels={vi.fn(async () => ["anthropic/claude"])}
        hideLegacyModelPicker={hideLegacyModelPicker}
      />,
    );
  }

  it("keeps the opencode model picker by default", () => {
    renderWith();
    expect(screen.getByTitle("Select model")).toBeTruthy();
  });

  it("hides the opencode model picker when the session has its own model option", () => {
    renderWith(true);
    expect(screen.queryByTitle("Select model")).toBeNull();
  });
});


describe("TiptapInput beforeProviderSlot", () => {
  function toolbarTestIds(container: HTMLElement): string[] {
    const provider = container.querySelector("[data-testid=\"provider-dropdown\"]");
    const toolbar = provider?.parentElement?.parentElement;
    return Array.from(toolbar?.querySelectorAll("[data-testid]") ?? []).map((node) => node.getAttribute("data-testid") ?? "");
  }

  it("renders the slot right before the provider capsule", () => {
    const { container } = render(
      <TiptapInput
        onSend={vi.fn()}
        selectedProvider="dsh"
        onRepoChange={vi.fn()}
        repoSelection={null}
        beforeProviderSlot={<div data-testid="slot-picker" />}
      />,
    );
    const ids = toolbarTestIds(container);
    expect(ids.indexOf("slot-picker")).toBeGreaterThan(-1);
    expect(ids.indexOf("slot-picker")).toBe(ids.indexOf("provider-dropdown") - 1);
  });

  it("adds no extra node when the slot is not passed", () => {
    const { container } = render(
      <TiptapInput onSend={vi.fn()} selectedProvider="dsh" onRepoChange={vi.fn()} repoSelection={null} />,
    );
    const providerWrapper = container.querySelector("[data-testid=\"provider-dropdown\"]")?.parentElement;
    // The provider capsule wrapper directly follows the repo picker wrapper, as before.
    expect(providerWrapper?.previousElementSibling?.querySelector("[data-testid=\"repo-picker\"]")).toBeTruthy();
    expect(toolbarTestIds(container).slice(0, 2)).toEqual(["repo-picker", "provider-dropdown"]);
  });
});

describe("TiptapInput placeholder follows prop and locale changes", () => {
  function placeholderOf(container: HTMLElement): string | null {
    return container.querySelector(".is-editor-empty")?.getAttribute("data-placeholder") ?? null;
  }

  it("updates the editor's data-placeholder after the editor is built", async () => {
    const { container, rerender } = render(
      <TiptapInput onSend={vi.fn()} selectedProvider="dsh" placeholder="Describe the problem to solve" onRepoChange={vi.fn()} repoSelection={null} />,
    );
    await waitFor(() => expect(placeholderOf(container)).toContain("Describe the problem to solve"));

    rerender(<TiptapInput onSend={vi.fn()} selectedProvider="dsh" placeholder="描述要解决的问题" onRepoChange={vi.fn()} repoSelection={null} />);
    await waitFor(() => expect(placeholderOf(container)).toContain("描述要解决的问题"));
    expect(placeholderOf(container)).not.toContain("Describe the problem");
    expect(screen.getByTestId("tiptap-editor").getAttribute("aria-label")).toContain("描述要解决的问题");
  });

  it("falls back to the dictionary placeholder instead of hard-coded English", async () => {
    const { container } = render(<TiptapInput onSend={vi.fn()} selectedProvider="dsh" onRepoChange={vi.fn()} repoSelection={null} />);
    await waitFor(() => expect(placeholderOf(container)).toContain("Dictionary placeholder"));
    expect(placeholderOf(container)).not.toContain("Type a message...");
  });
});

describe("TiptapInput insertTextRequest", () => {
  beforeAll(() => {
    // jsdom has no layout; focus("end") scrolls the selection into view through Range rects.
    const proto = Range.prototype as unknown as Record<string, unknown>;
    if (!proto.getClientRects) proto.getClientRects = () => [];
    if (!proto.getBoundingClientRect) proto.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 });
  });
  type Editorish = { getText: () => string; getJSON: () => unknown };
  const editorOf = () => (screen.getByTestId("tiptap-editor") as unknown as { editor: Editorish }).editor;
  const base = { selectedProvider: "dsh", onRepoChange: vi.fn(), repoSelection: null };

  it("replace sets plain text once per nonce, append adds '#name ' as text, never a hashMention", async () => {
    const onSend = vi.fn();
    const { rerender } = render(<TiptapInput {...base} onSend={onSend} insertTextRequest={{ text: "排查一个线上报错并修复", nonce: 1, mode: "replace" }} />);
    await waitFor(() => expect(editorOf()?.getText()).toBe("排查一个线上报错并修复"));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("tiptap-editor")));

    rerender(<TiptapInput {...base} onSend={onSend} insertTextRequest={{ text: "排查一个线上报错并修复", nonce: 1, mode: "replace" }} />);
    rerender(<TiptapInput {...base} onSend={onSend} insertTextRequest={{ text: "排查一个线上报错并修复", nonce: 1, mode: "replace" }} />);
    expect(editorOf().getText()).toBe("排查一个线上报错并修复");

    rerender(<TiptapInput {...base} onSend={onSend} insertTextRequest={{ text: "#前端开发 ", nonce: 2, mode: "append" }} />);
    await waitFor(() => expect(editorOf().getText().endsWith("#前端开发 ")).toBe(true));
    expect(editorOf().getText().startsWith("排查一个线上报错并修复")).toBe(true);
    expect(JSON.stringify(editorOf().getJSON())).not.toContain("hashMention");
    expect(document.querySelector(".agent-mention")).toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("sending inserted text gives the same onSend arguments as the same text typed in", async () => {
    const inserted = vi.fn();
    const first = render(<TiptapInput {...base} onSend={inserted} insertTextRequest={{ text: "#前端开发 修登录", nonce: 7, mode: "replace" }} />);
    await waitFor(() => expect(editorOf()?.getText()).toBe("#前端开发 修登录"));
    fireEvent.click(screen.getByTestId("tiptap-send-button"));
    await waitFor(() => expect(inserted).toHaveBeenCalledTimes(1));
    first.unmount();

    const typed = vi.fn();
    render(<TiptapInput {...base} onSend={typed} prefillText="#前端开发 修登录" />);
    await waitFor(() => expect(editorOf()?.getText()).toBe("#前端开发 修登录"));
    fireEvent.click(screen.getByTestId("tiptap-send-button"));
    await waitFor(() => expect(typed).toHaveBeenCalledTimes(1));

    expect(inserted.mock.calls[0]).toEqual(typed.mock.calls[0]);
    expect((inserted.mock.calls[0][1] as { provider?: string }).provider).toBeUndefined();
    expect(inserted.mock.calls[0][0]).toContain("#前端开发");
  });
});
