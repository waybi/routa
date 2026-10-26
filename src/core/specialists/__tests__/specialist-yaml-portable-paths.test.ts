// @vitest-environment node
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

import { loadSpecialistsFromDirectory } from "../specialist-file-loader";

// Specialist prompts run on two machines whose knowledge base lives at different absolute
// paths. Bash uses ~/Desktop/my/knowledge-system; read/grep/glob use the machine's absolute
// path taken at run time (resolver 「知识库目录」 line or `pwd -P`). No yaml may hard-code it.
const bundledRoot = path.join(process.cwd(), "resources", "specialists");
const HARDCODED_KB = /\/Users\/[^/]+\/Desktop\/(topgames_work\/Vault|my\/knowledge-system)/;

function listYaml(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listYaml(full);
    return entry.isFile() && /\.ya?ml$/.test(entry.name) ? [full] : [];
  });
}

describe("specialist yaml has no machine-specific knowledge-base path", () => {
  const files = fs.existsSync(bundledRoot) ? listYaml(bundledRoot) : [];

  it("scans at least one yaml file", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("no file hard-codes /Users/<name>/Desktop/(topgames_work/Vault|my/knowledge-system)", () => {
    const hits = files.flatMap((file) =>
      fs
        .readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) => (HARDCODED_KB.test(line) ? [`${path.relative(bundledRoot, file)}:${i + 1}: ${line.trim()}`] : [])),
    );
    expect(hits, hits.join("\n")).toEqual([]);
  });
});

const loadPaths: Array<[string, string, string | undefined]> = [
  ["default", bundledRoot, undefined],
  ["en", path.join(bundledRoot, "locales", "en"), "en"],
  ["zh-CN", path.join(bundledRoot, "locales", "zh-CN"), "zh-CN"],
];
const KB_ROLES = ["kanban-todo-orchestrator", "kanban-knowledge-reviewer", "kanban-flight-review-guard", "kanban-high-risk-reviewer"];
const PWD_FALLBACK = "cd ~/Desktop/my/knowledge-system && pwd -P";
const SEARCH = "python3 ~/Desktop/my/knowledge-system/distill/_index/search.py";

describe.each(loadPaths)("knowledge-base roles use the portable path (%s)", (_label, dir, locale) => {
  const specialists = loadSpecialistsFromDirectory(dir, "bundled", locale);

  it.each(KB_ROLES)("%s: bash uses ~, tools get an absolute path, ~/$HOME never reach read/grep/glob", (id) => {
    const text = specialists.find((entry) => entry.id === id)?.behaviorPrompt ?? "";
    expect(text, id).not.toBe("");
    expect(text, id).toContain("~/Desktop/my/knowledge-system");
    expect(text, id).toContain(PWD_FALLBACK);
    expect(text, id).toMatch(/`~` \/ `\$HOME`[^\n]*read\/grep\/glob/);
    if (id !== "kanban-knowledge-reviewer") expect(text, id).toContain("知识库目录");
    if (id === "kanban-todo-orchestrator" || id === "kanban-knowledge-reviewer") expect(text, id).toContain(SEARCH);
  });
});
