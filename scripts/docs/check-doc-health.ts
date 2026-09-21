#!/usr/bin/env node

/**
 * check-doc-health.ts
 *
 * Automated documentation health checks:
 * 1. specialist_docs_freshness — docs/specialists/ generated content matches YAML sources
 * 2. architecture_adr_sync — all ADR files listed in docs/adr/README.md and docs/ARCHITECTURE.md
 * 3. agents_md_repo_map — AGENTS.md Repository Map paths resolve to existing files/dirs
 * 4. doc_cross_refs — key doc files' internal cross-refs point to existing targets
 */

import fs from "node:fs";
import path from "node:path";

import { fromRoot } from "../lib/paths";

// ─── helpers ────────────────────────────────────────────────────────────────

let exitCode = 0;
let passCount = 0;
let failCount = 0;

function pass(name: string, detail?: string): void {
  passCount++;
  console.log(`✅ ${name}${detail ? `: ${detail}` : ""}`);
}

function fail(name: string, detail: string): void {
  failCount++;
  exitCode = 1;
  console.error(`❌ ${name}: ${detail}`);
}

function fileExists(rel: string): boolean {
  return fs.existsSync(fromRoot(rel));
}

// ─── 1) specialist docs freshness ───────────────────────────────────────────

function checkSpecialistDocsFreshness(): void {
  const name = "specialist_docs_freshness";

  // Count base specialist YAML files (excluding locales and specs)
  const specialistsDir = fromRoot("resources", "specialists");
  if (!fs.existsSync(specialistsDir)) {
    fail(name, "resources/specialists/ directory not found");
    return;
  }

  const yamlFiles: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const rel = path.relative(specialistsDir, fullPath);
      if (entry.isDirectory()) {
        // skip locales and specs subdirectories
        if (rel.startsWith("locales") || rel.startsWith("specs")) continue;
        walk(fullPath);
      } else if (entry.name.endsWith(".yaml")) {
        yamlFiles.push(fullPath);
      }
    }
  };
  walk(specialistsDir);

  const readmePath = fromRoot("docs", "specialists", "README.md");
  if (!fs.existsSync(readmePath)) {
    fail(name, `docs/specialists/README.md missing — run: npm run docs:specialists:generate`);
    return;
  }

  const readmeContent = fs.readFileSync(readmePath, "utf8");
  const countMatch = readmeContent.match(/基础 specialist 数量：`(\d+)`/);
  const docCount = countMatch ? parseInt(countMatch[1], 10) : -1;

  if (docCount !== yamlFiles.length) {
    fail(
      name,
      `docs/specialists/README.md reports ${docCount} specialists but ${yamlFiles.length} base YAML files exist — regenerate with: npm run docs:specialists:generate`,
    );
    return;
  }

  // Count generated doc pages (excluding README.md and _category_.json)
  const docsDir = fromRoot("docs", "specialists");
  const generatedDocs: string[] = [];
  const walkDocs = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDocs(fullPath);
      } else if (entry.name.endsWith(".md") && entry.name !== "README.md") {
        generatedDocs.push(fullPath);
      }
    }
  };
  walkDocs(docsDir);

  if (generatedDocs.length !== yamlFiles.length) {
    fail(
      name,
      `${generatedDocs.length} generated doc pages but ${yamlFiles.length} base YAML files — regenerate with: npm run docs:specialists:generate`,
    );
    return;
  }

  pass(name, `${yamlFiles.length} specialists, ${generatedDocs.length} docs present`);
}

// ─── 2) ADR sync ────────────────────────────────────────────────────────────

function checkAdrSync(): void {
  const name = "architecture_adr_sync";
  const adrDir = fromRoot("docs", "adr");

  if (!fs.existsSync(adrDir)) {
    fail(name, "docs/adr/ directory not found");
    return;
  }

  // Collect numbered ADR files
  const adrFiles = fs
    .readdirSync(adrDir)
    .filter((f) => /^\d{4}-/.test(f) && f.endsWith(".md"))
    .sort();

  if (adrFiles.length === 0) {
    pass(name, "no ADR files to check");
    return;
  }

  // Check docs/adr/README.md
  const adrReadmePath = fromRoot("docs", "adr", "README.md");
  const archPath = fromRoot("docs", "ARCHITECTURE.md");

  const errors: string[] = [];

  if (fs.existsSync(adrReadmePath)) {
    const adrReadme = fs.readFileSync(adrReadmePath, "utf8");
    for (const adrFile of adrFiles) {
      if (!adrReadme.includes(adrFile)) {
        errors.push(`docs/adr/README.md missing reference to ${adrFile}`);
      }
    }
  } else {
    errors.push("docs/adr/README.md not found");
  }

  if (fs.existsSync(archPath)) {
    const archContent = fs.readFileSync(archPath, "utf8");
    for (const adrFile of adrFiles) {
      if (!archContent.includes(adrFile)) {
        errors.push(`docs/ARCHITECTURE.md missing reference to ${adrFile}`);
      }
    }
  } else {
    errors.push("docs/ARCHITECTURE.md not found");
  }

  if (errors.length > 0) {
    fail(name, errors.join("; "));
  } else {
    pass(name, `${adrFiles.length} ADRs all referenced in README and ARCHITECTURE`);
  }
}

// ─── 3) AGENTS.md Repository Map ───────────────────────────────────────────

function checkAgentsMdRepoMap(): void {
  const name = "agents_md_repo_map";
  const agentsMdPath = fromRoot("AGENTS.md");

  if (!fs.existsSync(agentsMdPath)) {
    fail(name, "AGENTS.md not found");
    return;
  }

  const content = fs.readFileSync(agentsMdPath, "utf8");

  // Extract the Repository Map section
  const repoMapMatch = content.match(/## Repository Map\n([\s\S]*?)(?=\n## |$)/);
  if (!repoMapMatch) {
    fail(name, "No '## Repository Map' section found in AGENTS.md");
    return;
  }

  const repoMapSection = repoMapMatch[1];

  // Extract backtick-quoted paths from the section
  const pathPattern = /`([^`]+\.[a-z]+|[^`]+\/)`/g;
  const errors: string[] = [];
  let match;

  while ((match = pathPattern.exec(repoMapSection)) !== null) {
    const refPath = match[1].replace(/\/$/, ""); // strip trailing slash
    // Skip patterns with wildcards, URLs, or CLI commands
    if (refPath.includes("*") || refPath.includes("://") || refPath.startsWith("-")) continue;
    if (!fileExists(refPath)) {
      errors.push(`${refPath} (referenced in AGENTS.md Repository Map) not found`);
    }
  }

  if (errors.length > 0) {
    fail(name, errors.join("; "));
  } else {
    pass(name, "all Repository Map paths resolve");
  }
}

// ─── 4) Key doc cross-refs ──────────────────────────────────────────────────

function checkDocCrossRefs(): void {
  const name = "doc_cross_refs";
  const keyDocs = [
    "docs/ARCHITECTURE.md",
    "docs/adr/README.md",
    "docs/fitness/README.md",
    "docs/references/README.md",
  ];

  const errors: string[] = [];

  for (const docRel of keyDocs) {
    const docPath = fromRoot(docRel);
    if (!fs.existsSync(docPath)) {
      errors.push(`${docRel} not found`);
      continue;
    }

    const content = fs.readFileSync(docPath, "utf8");
    const docDir = path.dirname(docPath);

    // Extract markdown link targets: [text](target)
    const linkPattern = /\[([^\]]*)\]\(([^)]+)\)/g;
    let linkMatch;

    while ((linkMatch = linkPattern.exec(content)) !== null) {
      const target = linkMatch[2];
      // Skip external links, anchors, protocol links
      if (target.startsWith("http") || target.startsWith("#") || target.startsWith("mailto:")) continue;

      // Strip anchor from target
      const cleanTarget = target.split("#")[0];
      if (!cleanTarget) continue;

      const resolvedPath = path.resolve(docDir, cleanTarget);
      if (!fs.existsSync(resolvedPath)) {
        errors.push(`${docRel}: broken link to ${cleanTarget}`);
      }
    }
  }

  if (errors.length > 0) {
    fail(name, errors.join("; "));
  } else {
    pass(name, `${keyDocs.length} key docs, all cross-refs valid`);
  }
}

// ─── main ───────────────────────────────────────────────────────────────────

function main(): void {
  console.log("=== Documentation Health Check ===\n");

  checkSpecialistDocsFreshness();
  checkAdrSync();
  checkAgentsMdRepoMap();
  checkDocCrossRefs();

  console.log(`\n--- Summary: ${passCount} passed, ${failCount} failed ---`);

  if (failCount === 0) {
    console.log("doc_health_ok");
  } else {
    console.log("doc_health_failed");
  }

  process.exit(exitCode);
}

main();
