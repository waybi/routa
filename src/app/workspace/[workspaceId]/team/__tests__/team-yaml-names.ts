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

export interface YamlSpecialist { id: string; name: string; role: string; description: string; defaultModelTier: string }

/** Bundled team specialists as /api/specialists returns them (id, name, role, description, model tier from yaml). */
export function readTeamSpecialists(dir = join(SPECIALISTS_ROOT, "team")): YamlSpecialist[] {
  return readdirSync(dir).filter((name) => name.endsWith(".yaml")).sort().map((file) => {
    const text = readFileSync(join(dir, file), "utf8");
    const field = (key: string) => text.match(new RegExp(`^${key}:\\s*"([^"]*)"`, "m"))?.[1] ?? "";
    return { id: field("id"), name: field("name"), role: field("role"), description: field("description"), defaultModelTier: field("model_tier") };
  });
}
