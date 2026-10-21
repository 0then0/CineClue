import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

// Separate commands also support resuming individual stages using their response cache.
const directory = resolve(
  process.argv[2] ?? `/tmp/cineclue-expansion-${new Date().toISOString().slice(0, 10)}`,
);
const run = promisify(execFile);
for (const stage of ["identities.ts", "download-popular.ts", "publish-expanded.ts"]) {
  console.log(`Running ${stage}; cache: ${directory}`);
  const child = run(process.execPath, [resolve(import.meta.dirname, stage), directory], {
    maxBuffer: 16 * 1024 * 1024,
  });
  child.child.stdout?.pipe(process.stdout);
  child.child.stderr?.pipe(process.stderr);
  await child;
}
console.log(
  "Expanded snapshot ready in data/catalog.json. Run pnpm data:validate, then pnpm db:seed to apply it.",
);
