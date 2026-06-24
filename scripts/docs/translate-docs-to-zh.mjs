#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = process.cwd();
const docsDir = join(root, "docs");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
const listArg = process.argv.find((arg) => arg.startsWith("--list="));
const stateArg = process.argv.find((arg) => arg.startsWith("--state="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : Number.POSITIVE_INFINITY;
const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");
const chunked = process.argv.includes("--chunked");
const listPath = listArg ? join(root, listArg.split("=")[1]) : null;
const statePath = stateArg ? join(root, stateArg.split("=")[1]) : join(root, ".tmp", "docs-zh-translation-state.json");

function walk(dir) {
  const entries = readdirSorted(dir);
  return entries.flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function readdirSorted(dir) {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
}

function toRelative(pathname) {
  return pathname.slice(root.length + 1);
}

function targetFor(source) {
  return source.replace(/\.(md|txt)$/i, ".zh-CN.$1");
}

function languageStats(text) {
  const zh = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  const words = text.match(/[A-Za-z][A-Za-z0-9_-]*/g)?.length ?? 0;
  return { zh, latin, words, zhRatio: zh / (zh + latin || 1) };
}

function isEnglishDoc(text) {
  const stats = languageStats(text);
  return stats.words >= 80 && stats.zhRatio < 0.08;
}

function loadState() {
  if (!existsSync(statePath)) return { done: {}, failed: {} };
  return JSON.parse(readFileSync(statePath, "utf8"));
}

function saveState(state) {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", "--output-format", "text", "--permission-mode", "dontAsk", prompt], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 && stdout.trim()) resolve(stdout);
      else reject(new Error(`claude exited ${code}: ${stderr || stdout}`));
    });
  });
}

function extractTranslation(raw) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```$/i);
  return fenced ? fenced[1].trimEnd() + "\n" : trimmed + "\n";
}

function splitMarkdown(text) {
  const maxChars = 7000;
  const lines = text.split("\n");
  const chunks = [];
  let current = [];
  let currentLength = 0;
  for (const line of lines) {
    const startsNewSection = /^#{1,2}\s/.test(line) && currentLength > maxChars;
    if (startsNewSection || currentLength + line.length > maxChars * 1.4) {
      chunks.push(current.join("\n"));
      current = [];
      currentLength = 0;
    }
    current.push(line);
    currentLength += line.length + 1;
  }
  if (current.length > 0) chunks.push(current.join("\n"));
  return chunks;
}

async function translateText(relativeSource, sourceText) {
  if (!chunked || sourceText.length < 9000) {
    return extractTranslation(await runClaude(buildPrompt(relativeSource, sourceText)));
  }
  const chunks = splitMarkdown(sourceText);
  const translatedChunks = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const raw = await runClaude(buildPrompt(`${relativeSource} chunk ${index + 1}/${chunks.length}`, chunks[index]));
    translatedChunks.push(extractTranslation(raw).trimEnd());
  }
  return `${translatedChunks.join("\n")}\n`;
}

function buildPrompt(relativeSource, sourceText) {
  return `Translate the following Routa.js documentation file into Simplified Chinese.\n\nRules:\n- Output ONLY the translated file content. No preface, no explanation.\n- Preserve Markdown structure, frontmatter delimiters, tables, lists, headings, links, anchors, admonitions, and relative paths.\n- Preserve code blocks, inline code, commands, file paths, API paths, identifiers, YAML keys, JSON keys, package names, product names, issue numbers, and URLs exactly unless they are ordinary prose comments.\n- Translate natural-language prose, headings, table prose, frontmatter prose values, and quoted explanatory text.\n- Keep frontmatter keys unchanged, but translate user-facing string values such as title, description, purpose, and summary. For example, title: Self-Hosting should become title: 自托管.\n- Keep technical terms consistent: workspace=工作区, session=会话, task=任务, kanban=看板, agent=Agent, harness=Harness, trace=Trace, fitness function=适应度函数, provider=Provider, desktop=桌面端, web=Web 端.\n- If the source is already mostly Chinese, still return a clean Chinese version without adding notes.\n\nFile: ${relativeSource}\n\n--- SOURCE START ---\n${sourceText}\n--- SOURCE END ---`;
}

const listFiles = listPath && existsSync(listPath)
  ? readFileSync(listPath, "utf8").split(/\r?\n/).filter(Boolean).map((file) => join(root, file))
  : null;
const allFiles = (listFiles ?? walk(docsDir)).filter((file) => /\.(md|txt)$/i.test(file) && !/\.zh-CN\.(md|txt)$/i.test(file));
let candidates = allFiles.filter((file) => {
  if (onlyArg && !toRelative(file).includes(onlyArg.split("=")[1])) return false;
  const text = readFileSync(file, "utf8");
  const target = targetFor(file);
  return isEnglishDoc(text) && (force || !existsSync(target));
});

const state = loadState();
candidates = candidates.filter((file) => force || !state.done[toRelative(file)]).slice(0, limit);

console.log(JSON.stringify({ candidates: candidates.length, dryRun, force, chunked }, null, 2));
if (dryRun) {
  for (const file of candidates) console.log(`${toRelative(file)} -> ${toRelative(targetFor(file))}`);
  process.exit(0);
}

for (const file of candidates) {
  const relativeSource = toRelative(file);
  const target = targetFor(file);
  const relativeTarget = toRelative(target);
  const sourceText = readFileSync(file, "utf8");
  console.log(`translating ${relativeSource} -> ${relativeTarget}`);
  try {
    const translated = await translateText(relativeSource, sourceText);
    const stats = languageStats(translated);
    if (stats.zh < 20 || stats.zhRatio < 0.05) {
      throw new Error(`translation looks non-Chinese: zh=${stats.zh}, zhRatio=${stats.zhRatio.toFixed(3)}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, translated);
    state.done[relativeSource] = { target: relativeTarget, translatedAt: new Date().toISOString(), zhRatio: stats.zhRatio };
    delete state.failed[relativeSource];
    saveState(state);
  } catch (error) {
    state.failed[relativeSource] = { target: relativeTarget, error: String(error), failedAt: new Date().toISOString() };
    saveState(state);
    console.error(`failed ${relativeSource}: ${error}`);
  }
}
