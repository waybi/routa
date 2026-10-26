// @vitest-environment node
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";

import {
  isCanonicalTeamSpecialistId,
  mergeSpecialistDefinitions,
  getLocaleOverlayDirs,
  loadSpecialistsFromDirectory,
  loadBundledSpecialists,
} from "../specialist-file-loader";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "specialist-loader-"));
  tempDirs.push(dir);
  return dir;
}

function writeYamlSpecialist(filePath: string, id: string, name: string, prompt: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `id: "${id}"
name: "${name}"
description: "${name} description"
role: "DEVELOPER"
model_tier: "smart"
system_prompt: |
  ${prompt}
`,
    "utf8"
  );
}

function writeYamlOverlay(filePath: string, id: string, name: string, prompt: string): void {
  writeYamlSpecialist(filePath, id, name, prompt);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("specialist-file-loader", () => {
  it("loads yaml specialists recursively while skipping locale directories in the base scan", () => {
    const rootDir = createTempDir();
    writeYamlSpecialist(path.join(rootDir, "core", "developer.yaml"), "developer", "Developer", "Developer body");
    writeYamlSpecialist(path.join(rootDir, "team", "qa.yaml"), "team-qa", "QA", "QA body");
    writeYamlOverlay(path.join(rootDir, "zh-CN", "developer.yaml"), "developer", "开发者", "开发者 body");
    writeYamlOverlay(path.join(rootDir, "locales", "zh-CN", "team", "qa.yaml"), "team-qa", "测试", "测试 body");

    const loaded = loadSpecialistsFromDirectory(rootDir, "bundled");

    expect(loaded.map((entry) => entry.id).sort()).toEqual(["developer", "team-qa"]);
    expect(loaded.every((entry) => entry.locale === undefined)).toBe(true);
  });

  it("loads locale overlays from both new and legacy directory layouts", () => {
    const rootDir = createTempDir();
    const newLocaleDir = path.join(rootDir, "locales", "zh-CN");
    const legacyLocaleDir = path.join(rootDir, "zh-CN");
    writeYamlOverlay(path.join(newLocaleDir, "core", "developer.yaml"), "developer", "开发者", "开发者 body");
    writeYamlOverlay(path.join(legacyLocaleDir, "review", "gate.yaml"), "gate", "验证者", "验证者 body");

    expect(getLocaleOverlayDirs(rootDir, "zh-CN").sort()).toEqual(
      [legacyLocaleDir, newLocaleDir].sort()
    );

    const loaded = getLocaleOverlayDirs(rootDir, "zh-CN").flatMap((dirPath) =>
      loadSpecialistsFromDirectory(dirPath, "bundled", "zh-CN")
    );

    expect(loaded.map((entry) => `${entry.id}:${entry.locale}`).sort()).toEqual([
      "developer:zh-CN",
      "gate:zh-CN",
    ]);
  });

  it("uses frontmatter ids for taxonomy locale overlays after filename renames", () => {
    const rootDir = createTempDir();
    const localeDir = path.join(rootDir, "locales", "en", "team");
    writeYamlOverlay(
      path.join(localeDir, "agent-lead.yaml"),
      "team-agent-lead",
      "Agent Lead",
      "Agent Lead body"
    );

    const loaded = loadSpecialistsFromDirectory(localeDir, "bundled", "en");

    expect(loaded.map((entry) => entry.id)).toEqual(["team-agent-lead"]);
    expect(loaded[0]?.locale).toBe("en");
  });

  it("keeps only canonical bundled team specialist ids", () => {
    const rootDir = createTempDir();
    writeYamlSpecialist(
      path.join(rootDir, "team", "frontend-dev.yaml"),
      "team-frontend-dev",
      "Frontend Dev",
      "Frontend body"
    );
    writeYamlSpecialist(
      path.join(rootDir, "team", "frontend-dev-lee.yaml"),
      "team-frontend-dev-lee",
      "Frontend Dev Lee",
      "Lee body"
    );

    const loaded = loadSpecialistsFromDirectory(rootDir, "bundled");

    expect(loaded.map((entry) => entry.id)).toEqual(["team-frontend-dev"]);
  });

  it("skips bundled team directory files even when they use non-team ids", () => {
    const rootDir = createTempDir();
    writeYamlSpecialist(
      path.join(rootDir, "team", "backend-dev.yaml"),
      "team-backend-dev",
      "Backend Dev",
      "Backend body"
    );
    writeYamlSpecialist(
      path.join(rootDir, "team", "backend-dev-bill.yaml"),
      "backend-dev-bill",
      "Backend Dev Bill",
      "Bill body"
    );

    const loaded = loadSpecialistsFromDirectory(rootDir, "bundled");

    expect(loaded.map((entry) => entry.id)).toEqual(["team-backend-dev"]);
  });

  it("allows non-canonical team ids in user specialist directories", () => {
    const rootDir = createTempDir();
    writeYamlSpecialist(
      path.join(rootDir, "team", "frontend-dev-lee.yaml"),
      "team-frontend-dev-lee",
      "Frontend Dev Lee",
      "Lee body"
    );

    const loaded = loadSpecialistsFromDirectory(rootDir, "user");

    expect(loaded.map((entry) => entry.id)).toEqual(["team-frontend-dev-lee"]);
  });

  it("recognizes the canonical team specialist id allowlist", () => {
    expect(isCanonicalTeamSpecialistId("team-agent-lead")).toBe(true);
    expect(isCanonicalTeamSpecialistId("team-frontend-dev")).toBe(true);
    expect(isCanonicalTeamSpecialistId("team-frontend-dev-lee")).toBe(false);
    expect(isCanonicalTeamSpecialistId("frontend-dev")).toBe(false);
  });

  it("uses the new locale overlay path for bundled specialist directories", () => {
    const repoRoot = createTempDir();
    const previousCwd = process.cwd();

    try {
      process.chdir(repoRoot);
      writeYamlOverlay(
        path.join(repoRoot, "resources", "specialists", "locales", "zh-CN", "developer.yaml"),
        "developer",
        "开发者",
        "开发者 body"
      );

      const loaded = loadBundledSpecialists("zh-CN");
      expect(loaded.map((entry) => entry.id)).toEqual(["developer"]);
      expect(loaded[0]?.locale).toBe("zh-CN");
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("ignores markdown files in runtime specialist directories", () => {
    const rootDir = createTempDir();
    fs.writeFileSync(
      path.join(rootDir, "developer.md"),
      `---
name: "Developer Markdown"
description: "Legacy runtime definition"
role: "DEVELOPER"
---

markdown prompt
`,
      "utf8"
    );
    writeYamlSpecialist(path.join(rootDir, "developer.yaml"), "developer", "Developer YAML", "yaml prompt");

    const loaded = loadSpecialistsFromDirectory(rootDir, "bundled");

    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.frontmatter.name).toBe("Developer YAML");
    expect(loaded[0]?.behaviorPrompt).toBe("yaml prompt");
  });

  it("fails when duplicate ids are merged", () => {
    const rootDir = createTempDir();
    const first = path.join(rootDir, "core", "developer.yaml");
    const second = path.join(rootDir, "review", "developer.yaml");

    writeYamlSpecialist(first, "developer", "Developer Old", "old");
    writeYamlSpecialist(second, "developer", "Developer New", "new");

    expect(() =>
      mergeSpecialistDefinitions(
        [
          {
            id: "developer",
            filePath: first,
            frontmatter: { name: "Developer Old", description: "old" },
            behaviorPrompt: "old",
            rawContent: "old",
            source: "bundled",
            locale: "zh-CN",
          },
          {
            id: "developer",
            filePath: second,
            frontmatter: { name: "Developer New", description: "new" },
            behaviorPrompt: "new",
            rawContent: "new",
            source: "bundled",
            locale: "zh-CN",
          },
        ],
        "test merge"
      )
    ).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining('Duplicate specialist id "developer" in test merge'),
      })
    );
  });

  it("fails when a runtime directory contains duplicate ids", () => {
    const rootDir = createTempDir();
    writeYamlSpecialist(path.join(rootDir, "core", "developer.yaml"), "developer", "Developer", "first");
    writeYamlSpecialist(path.join(rootDir, "review", "developer.yaml"), "developer", "Developer Duplicate", "second");

    expect(() => loadSpecialistsFromDirectory(rootDir, "bundled")).toThrowError(
      expect.objectContaining({
        message: expect.stringContaining(`directory ${rootDir}`),
      })
    );
  });

  it("keeps bundled locale overlays in taxonomy paths and aligned with runtime specialists", () => {
    const bundledRoot = path.join(process.cwd(), "resources", "specialists");
    const runtimeIds = loadSpecialistsFromDirectory(bundledRoot, "bundled")
      .map((entry) => entry.id)
      .sort();
    const englishOverlayIds = loadSpecialistsFromDirectory(
      path.join(bundledRoot, "locales", "en"),
      "bundled",
      "en"
    )
      .map((entry) => entry.id)
      .sort();
    const chineseOverlayIds = loadSpecialistsFromDirectory(
      path.join(bundledRoot, "locales", "zh-CN"),
      "bundled",
      "zh-CN"
    )
      .map((entry) => entry.id)
      .sort();

    expect(fs.existsSync(path.join(bundledRoot, "zh-CN"))).toBe(false);
    expect(runtimeIds).toContain("view-git-change");
    expect(englishOverlayIds).toEqual(runtimeIds);
    expect(chineseOverlayIds).toEqual(runtimeIds);
  });

  describe("bundled kanban-main-pusher", () => {
    const bundledRoot = path.join(process.cwd(), "resources", "specialists");
    const loadPaths: Array<[string, string, string | undefined]> = [
      ["default", bundledRoot, undefined],
      ["en", path.join(bundledRoot, "locales", "en"), "en"],
      ["zh-CN", path.join(bundledRoot, "locales", "zh-CN"), "zh-CN"],
    ];

    it.each(loadPaths)("loads from the %s path with a safe push prompt", (_label, dir, locale) => {
      const pusher = loadSpecialistsFromDirectory(dir, "bundled", locale).find(
        (entry) => entry.id === "kanban-main-pusher"
      );

      expect(pusher).toBeDefined();
      expect(pusher?.frontmatter.role?.trim()).toBeTruthy();
      expect(pusher?.behaviorPrompt.trim()).toBeTruthy();
      expect(pusher?.behaviorPrompt).toContain("merge-base --is-ancestor");
      expect(pusher?.behaviorPrompt).toContain("git push origin HEAD:");
      expect(pusher?.behaviorPrompt).toMatch(/Never use any force-push option|禁止任何强制推送/);
      expect(pusher?.behaviorPrompt).not.toContain("--force");
      // Target branch comes from the codebase registration (e.g. turnilo uses master), never hardcoded main.
      expect(pusher?.behaviorPrompt).not.toContain("HEAD:main");
      expect(pusher?.behaviorPrompt).not.toContain("origin/main");
    });

    it.each(loadPaths)("keeps the done reporter title rule and asks for the mainline commit (%s)", (_label, dir, locale) => {
      const reporter = loadSpecialistsFromDirectory(dir, "bundled", locale).find(
        (entry) => entry.id === "kanban-done-reporter"
      );

      expect(reporter).toBeDefined();
      expect(reporter?.behaviorPrompt).toContain("## 完成汇报");
      expect(reporter?.behaviorPrompt).toContain("## Completion Summary");
      expect(reporter?.behaviorPrompt).toContain("主干提交号");
      expect(reporter?.behaviorPrompt).toContain("Mainline commit");
      expect(reporter?.behaviorPrompt).toContain("未找到主干推送记录");
    });
  });

  describe("bundled kanban-topbi-porter", () => {
    const bundledRoot = path.join(process.cwd(), "resources", "specialists");
    const loadPaths: Array<[string, string, string | undefined]> = [
      ["default", bundledRoot, undefined],
      ["en", path.join(bundledRoot, "locales", "en"), "en"],
      ["zh-CN", path.join(bundledRoot, "locales", "zh-CN"), "zh-CN"],
    ];

    it.each(loadPaths)("loads from the %s path as a smart DEVELOPER", (_label, dir, locale) => {
      const porter = loadSpecialistsFromDirectory(dir, "bundled", locale).find(
        (entry) => entry.id === "kanban-topbi-porter"
      );

      expect(porter).toBeDefined();
      expect(porter?.frontmatter.role).toBe("DEVELOPER");
      expect(porter?.frontmatter.modelTier).toBe("smart");
      expect(porter?.behaviorPrompt.trim()).toBeTruthy();
    });

    it("uses a Chinese name in the zh-CN overlay", () => {
      const porter = loadSpecialistsFromDirectory(
        path.join(bundledRoot, "locales", "zh-CN"),
        "bundled",
        "zh-CN"
      ).find((entry) => entry.id === "kanban-topbi-porter");

      expect(porter?.frontmatter.name).toMatch(/[\u4e00-\u9fff]/);
    });
  });

  describe("bundled flight checklist specialists", () => {
    const bundledRoot = path.join(process.cwd(), "resources", "specialists");
    const loadPaths: Array<[string, string, string | undefined]> = [
      ["default", bundledRoot, undefined],
      ["en", path.join(bundledRoot, "locales", "en"), "en"],
      ["zh-CN", path.join(bundledRoot, "locales", "zh-CN"), "zh-CN"],
    ];
    const flightSpecialists: Array<{ id: string; role: string; prompt: Array<string | RegExp> }> = [
      {
        id: "kanban-contract-setter",
        role: "CRAFTER",
        prompt: [
          "## 验收契约（出题人）",
          "F1",
          "F2",
          "F3",
          "F4",
          /最多 8 条|at most 8/,
          /90 分钟|90 minutes/,
          "~/.routa/flight-checklist/<完整卡号>/regression.md",
          "flight_resolve.py --card <完整卡号>",
          "标准来源：",
          "回归题已出",
        ],
      },
      {
        id: "kanban-flight-dev-executor",
        role: "CRAFTER",
        prompt: [
          "## 验收契约（出题人）",
          "缺验收契约",
          "## 证据表",
          "/tmp/routa-evidence/",
          /改前|before the change/,
          /改后|after the change/,
          /撤掉实现|implementation reverted/,
          /花钱|spending money/,
          /删数据|deleting data/,
          /改线上|changing production/,
          /对外发消息|sending external messages/,
          "blocked",
        ],
      },
      {
        id: "kanban-flight-review-guard",
        role: "GATE",
        prompt: [
          /re-run every command in the card's `verificationCommands`|逐条复跑卡上 `verificationCommands` 的每一条/i,
          "## 证据表",
          /撤掉实现|Revert the implementation/,
          "~/.routa/flight-checklist/<完整卡号>/regression.md",
          "无回归题",
          /a=10/,
          "【评审打回 第 N 次】",
          /第 3 次|third/,
          "高风险：是/否",
        ],
      },
      {
        id: "kanban-high-risk-reviewer",
        role: "GATE",
        prompt: [
          "高风险：",
          "【评审打回 第 N 次】",
          /共用|shared/,
          /第 3 次|third/,
          "done",
          "blocked",
        ],
      },
    ];

    it.each(loadPaths)("loads every flight checklist specialist from the %s path", (_label, dir, locale) => {
      const loaded = loadSpecialistsFromDirectory(dir, "bundled", locale);
      for (const spec of flightSpecialists) {
        const entry = loaded.find((candidate) => candidate.id === spec.id);
        expect(entry, spec.id).toBeDefined();
        expect(entry?.frontmatter.role, spec.id).toBe(spec.role);
        expect(entry?.frontmatter.modelTier, spec.id).toBe("smart");
        if (locale === "zh-CN") {
          expect(entry?.frontmatter.name, spec.id).toMatch(/[\u4e00-\u9fff]/);
        }
        for (const text of spec.prompt) {
          if (typeof text === "string") {
            expect(entry?.behaviorPrompt, `${spec.id} should contain ${text}`).toContain(text);
          } else {
            expect(entry?.behaviorPrompt, `${spec.id} should match ${text}`).toMatch(text);
          }
        }
      }
    });
  });
});
