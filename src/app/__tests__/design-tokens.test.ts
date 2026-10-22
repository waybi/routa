import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Locks the redesign semantic tokens to design-spec.md §2.
 *
 * The expected tables below are transcribed from the spec, NOT derived from
 * globals.css — otherwise a wrong value in the stylesheet would assert
 * against itself and stay green.
 */
const EXPECTED_DARK: Record<string, string> = {
  "--bg": "#111214",
  "--side": "#151619",
  "--panel": "#191b1f",
  "--soft": "#202228",
  "--hover": "#252830",
  "--ink": "#eeeef1",
  "--muted": "#a0a5b0",
  "--line": "#30333b",
  "--accent": "#a5a7ff",
  "--accentbg": "#30314b",
  "--on": "#171723",
  "--red": "#ffa5ad",
  "--redbg": "#38232b",
  "--amber": "#f1c17a",
  "--amberbg": "#332c20",
  "--green": "#81d9ae",
  "--greenbg": "#1c332b",
  "--blue": "#9ac5ff",
  "--shadow": "0 24px 80px #0008",
};

const EXPECTED_LIGHT: Record<string, string> = {
  "--bg": "#fafafb",
  "--side": "#f1f2f5",
  "--panel": "#ffffff",
  "--soft": "#f4f5f8",
  "--hover": "#eaecf2",
  "--ink": "#1c1e25",
  "--muted": "#5e6470",
  "--line": "#dce0e7",
  "--accent": "#5153b5",
  "--accentbg": "#ececfc",
  "--on": "#ffffff",
  "--red": "#ae2f45",
  "--redbg": "#fff0f2",
  "--amber": "#82530b",
  "--amberbg": "#fff5e3",
  "--green": "#176a45",
  "--greenbg": "#eaf8f0",
  "--blue": "#245f9e",
  "--shadow": "0 24px 80px #1a24452b",
};

const EXPECTED_THEME_MAPPING: Record<string, string> = {
  "--color-canvas": "var(--bg)",
  "--color-sidebar": "var(--side)",
  "--color-surface": "var(--panel)",
  "--color-subtle": "var(--soft)",
  "--color-hover": "var(--hover)",
  "--color-primary": "var(--ink)",
  "--color-secondary": "var(--muted)",
  "--color-default": "var(--line)",
  "--color-accent": "var(--accent)",
  "--color-accent-subtle": "var(--accentbg)",
  "--color-on-accent": "var(--on)",
  "--color-danger": "var(--red)",
  "--color-danger-subtle": "var(--redbg)",
  "--color-attention": "var(--amber)",
  "--color-attention-subtle": "var(--amberbg)",
  "--color-success": "var(--green)",
  "--color-success-subtle": "var(--greenbg)",
  "--color-information": "var(--blue)",
  "--radius-control": "7px",
  "--shadow-overlay": "var(--shadow)",
};

const css = readFileSync(resolve(__dirname, "../globals.css"), "utf8");

/** Collects `--name: value;` declarations from every top-level block matching the selector. */
function declarationsFor(selector: string): Map<string, string> {
  const result = new Map<string, string>();
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const blockPattern = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^{}]*)\\}`, "g");
  for (const match of css.matchAll(blockPattern)) {
    for (const decl of match[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      result.set(decl[1], decl[2].trim());
    }
  }
  return result;
}

describe("redesign design tokens in globals.css", () => {
  it.each([
    ["html.dark", EXPECTED_DARK],
    ["html.light", EXPECTED_LIGHT],
  ] as const)("%s defines every spec variable with the spec value", (selector, expected) => {
    const actual = declarationsFor(selector);
    for (const [name, value] of Object.entries(expected)) {
      expect({ name, value: actual.get(name) }).toEqual({ name, value });
    }
  });

  it("maps every Tailwind semantic name in @theme inline", () => {
    const actual = declarationsFor("@theme inline");
    for (const [name, value] of Object.entries(EXPECTED_THEME_MAPPING)) {
      expect({ name, value: actual.get(name) }).toEqual({ name, value });
    }
  });

  it("does not define the redesign tokens on :root", () => {
    const rootDecls = declarationsFor(":root");
    for (const name of Object.keys(EXPECTED_DARK)) {
      expect(rootDecls.has(name)).toBe(false);
    }
  });
});
