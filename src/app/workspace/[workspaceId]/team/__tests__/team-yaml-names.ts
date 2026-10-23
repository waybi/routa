import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Reads `id` and `name` from every team specialist yaml in `dir` (top-level scalar lines only). */
export function readTeamSpecialistNames(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".yaml")).sort()) {
    const text = readFileSync(join(dir, file), "utf8");
    const id = text.match(/^id:\s*"([^"]+)"/m)?.[1];
    const name = text.match(/^name:\s*"([^"]+)"/m)?.[1];
    if (id && name) out[id] = name;
  }
  return out;
}

export const SPECIALISTS_ROOT = resolve(__dirname, "../../../../../../resources/specialists");
