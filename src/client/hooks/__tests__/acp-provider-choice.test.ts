/**
 * resolveComposerProviderId — which provider the composer shows before the
 * user picks one (card f1bc30c7 AC7 / contract C7, F2j, F3).
 */
import { describe, expect, it } from "vitest";
import { resolveComposerProviderId } from "../acp-provider-choice";

const base = { hasPickedProvider: false, selectedProvider: "opencode" };

describe("resolveComposerProviderId", () => {
  it.each([
    ["unavailable", "opencode"],
    ["available", "codex"],
    ["checking", "codex"],
  ])("preferred provider with status %s → %s", (status, expected) => {
    expect(resolveComposerProviderId({
      ...base,
      preferredDefaultProvider: "codex",
      providers: [{ id: "codex", status }, { id: "opencode", status: "available" }],
    })).toBe(expected);
  });

  it("keeps the user's own pick once they chose a provider in a composer", () => {
    expect(resolveComposerProviderId({
      ...base,
      hasPickedProvider: true,
      preferredDefaultProvider: "codex",
      providers: [{ id: "codex", status: "available" }],
    })).toBe("opencode");
  });

  it("uses selectedProvider when the preferred provider is not listed", () => {
    expect(resolveComposerProviderId({
      ...base,
      preferredDefaultProvider: "codex",
      providers: [{ id: "opencode", status: "available" }],
    })).toBe("opencode");
  });

  it("keeps choosing the preference when providers carry no status (pre-change behaviour)", () => {
    expect(resolveComposerProviderId({
      ...base,
      preferredDefaultProvider: "codex",
      providers: [{ id: "codex" }],
    })).toBe("codex");
  });

  it("uses selectedProvider without a preference or without a provider list", () => {
    expect(resolveComposerProviderId({ ...base, providers: [{ id: "codex" }] })).toBe("opencode");
    expect(resolveComposerProviderId({ ...base, preferredDefaultProvider: "codex" })).toBe("opencode");
  });

  it("F3: full combination cross-check against a judge written from AC7", () => {
    // Judge from the card: pick the preference only when it exists, the user has
    // not picked, it is listed, and its status is not "unavailable".
    const plantClientBug = process.env.ROUTA_F3_PLANT === "client";
    const judge = (preferred: string | undefined, picked: boolean, listed: Array<{ id: string; status?: string }>) => {
      if (!preferred || picked) return "selected";
      const entry = listed.find((provider) => provider.id === preferred);
      if (!entry) return "selected";
      if (entry.status === "unavailable") return "selected";
      if (plantClientBug && entry.status === "checking") return "selected";
      return preferred;
    };

    const mismatches: string[] = [];
    let total = 0;
    for (const preference of ["none", "listed", "unlisted"] as const) {
      for (const picked of [true, false]) {
        for (const status of ["available", "checking", "unavailable", undefined]) {
          for (const listKind of ["empty", "non-empty"] as const) {
            total += 1;
            const preferred = preference === "none" ? undefined : preference === "listed" ? "codex" : "gemini";
            const providers = listKind === "empty"
              ? []
              : [{ id: "codex", ...(status ? { status } : {}) }, { id: "opencode", status: "available" }];
            const actual = resolveComposerProviderId({
              preferredDefaultProvider: preferred,
              hasPickedProvider: picked,
              providers,
              selectedProvider: "selected",
            });
            const expected = judge(preferred, picked, providers);
            if (actual !== expected) {
              mismatches.push(`${preference}/picked=${picked}/status=${status ?? "none"}/${listKind}: expected ${expected}, got ${actual}`);
            }
          }
        }
      }
    }

    process.stdout.write(`F3 client cross-check: total=${total} pass=${total - mismatches.length} mismatches=${mismatches.length}${plantClientBug ? " (planted judge bug)" : ""}\n${mismatches.join("\n")}\n`);
    expect(mismatches).toEqual([]);
  });
});
