/**
 * Writes the skill bundle out for publishing.
 *
 * A thin wrapper, deliberately: everything that decides what the bundle SAYS
 * lives in `src/skill/bundle.ts`, which is pure and therefore testable without
 * a filesystem. This only puts the files somewhere.
 *
 * Run by the Pages workflow, which copies the result next to the game.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { skillBundle } from "../src/skill/bundle.js";

const out = process.argv[2] ?? "dist-skill";
mkdirSync(out, { recursive: true });

let total = 0;
for (const file of skillBundle()) {
  writeFileSync(join(out, file.path), file.text, "utf8");
  total += file.text.length;
  console.log(`  ${file.path.padEnd(16)} ${String(Math.round(file.text.length / 4)).padStart(6)} tokens`);
}
console.log(`wrote ${skillBundle().length} files, about ${Math.round(total / 4)} tokens in all, to ${out}/`);
