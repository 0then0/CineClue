import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { Catalog, packSchema } from "../../apps/api/src/catalog.ts";
import { pool } from "../../apps/api/src/db.ts";
import { mediaSnapshotSchema } from "../../apps/api/src/media.ts";
import { movieSchema } from "../../packages/game-engine/src/model.ts";
import {
  candidateSchema,
  enrichSeedCast,
  importedMedia,
  normalizeExpanded,
  selectExpanded,
} from "./expansion.ts";
import type { IdentityData } from "./identities.ts";
import { readJsonLines } from "./json-lines.ts";
import { snapshotSchema } from "./snapshot.ts";

const directory = resolve(process.argv[2] ?? "/tmp/cineclue-expansion");
const source = z
  .object({
    retrievedAt: z.iso.date(),
    candidates: z.array(candidateSchema),
    count: z.number().int().positive(),
    errors: z.array(z.object({ id: z.number(), error: z.string() })).default([]),
  })
  .parse(JSON.parse(await readFile(resolve(directory, "details.json"), "utf8")));
const identities = JSON.parse(
  await readFile(resolve(directory, "identities.json"), "utf8"),
) as IdentityData;
const base = z
  .array(movieSchema)
  .parse(JSON.parse(await readFile("data/seed/movies.json", "utf8")));
const packs = z.array(packSchema).parse(JSON.parse(await readFile("data/seed/packs.json", "utf8")));
const info = new Map(source.candidates.map((c) => [c.id, c]));
const baseIds = new Set(base.map((m) => m.id));
const seen = new Set(
  base.flatMap((m) => Object.entries(m.externalIds).map(([k, v]) => `${k}:${v}`)),
);
const normalized = [];
const media = new Map<string, ReturnType<typeof importedMedia>>();
const corrected = new Map<string, z.infer<typeof movieSchema>>();
const rejected: { id: unknown; reason: string }[] = [];
let existing = 0;
let readCount = 0;
for await (const raw of readJsonLines(resolve(directory, "details.jsonl"))) {
  readCount++;
  const id = (raw as { id?: number }).id;
  if (id && baseIds.has(identities.identities[`tmdb:${id}`] ?? "")) {
    const baseId = identities.identities[`tmdb:${id}`];
    const original = base.find((m) => m.id === baseId);
    if (!original) throw new Error("Missing original film");
    const enriched = enrichSeedCast(original, raw, identities, source.retrievedAt);
    corrected.set(original.id, enriched);
    media.set(original.id, importedMedia(raw, enriched, identities));
    existing++;
    continue;
  }
  const candidate = id ? info.get(id) : undefined;
  if (!candidate) throw new Error("Missing discovery metadata");
  try {
    const movie = await normalizeExpanded(raw, candidate, identities);
    normalized.push(movie);
    media.set(movie.id, importedMedia(raw, movie, identities));
  } catch (error) {
    rejected.push({
      id,
      reason:
        error instanceof z.ZodError
          ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
          : error instanceof Error
            ? error.message
            : "invalid",
    });
  }
}
if (readCount !== source.count)
  throw new Error("Incomplete detail stream; resume the downloader before publication");
normalized.sort(
  (a, b) =>
    (info.get(Number(b.externalIds.tmdb))?.vote_count ?? 0) -
      (info.get(Number(a.externalIds.tmdb))?.vote_count ?? 0) || a.id.localeCompare(b.id),
);
const unique = normalized.filter((movie) => {
  const keys = Object.entries(movie.externalIds).map(([key, value]) => `${key}:${value}`);
  if (keys.some((key) => seen.has(key))) {
    rejected.push({ id: movie.externalIds.tmdb, reason: "duplicate_external_id" });
    return false;
  }
  for (const key of keys) seen.add(key);
  return true;
});
if (corrected.size !== base.length)
  throw new Error("Missing credited cast for original films; rerun discovery with seed identities");
const movies = selectExpanded(
  base.map((m) => corrected.get(m.id) ?? m),
  unique,
  source.candidates,
);
const animation = packs.find((p) => p.id === "animation");
if (animation)
  animation.rules.movieIds = [
    ...new Set([
      ...(animation.rules.movieIds ?? []),
      ...movies.filter((m) => m.genres.some((g) => g.id === "Q202866")).map((m) => m.id),
    ]),
  ];
const snapshot = snapshotSchema.parse({
  version: 1,
  retrievedAt: source.retrievedAt,
  movies,
  packs,
});
const catalog = new Catalog(movies, packs);
const counts: Record<string, Record<string, number>> = {};
for (const pack of packs) {
  counts[pack.id] = {};
  for (const difficulty of ["easy", "normal", "hard"] as const) {
    const count = catalog.candidates(difficulty, pack.id).length;
    if (!count) throw new Error(`Empty collection ${pack.id}/${difficulty}`);
    counts[pack.id][difficulty] = count;
  }
}
const report = {
  retrievedAt: source.retrievedAt,
  candidateCount: source.candidates.length,
  existingPreserved: base.length,
  creditedCastEnriched: corrected.size,
  existingMatched: existing,
  completeNew: unique.length,
  providerMissing: source.errors,
  selected: movies.length,
  added: movies.length - base.length,
  countries: new Set(movies.flatMap((m) => m.countries.map((c) => c.id))).size,
  addedRussianLanguage: movies.filter(
    (m) => info.get(Number(m.externalIds.tmdb))?.original_language === "ru",
  ).length,
  years: [
    Math.min(...movies.map((m) => m.releaseYear)),
    Math.max(...movies.map((m) => m.releaseYear)),
  ],
  mappedIdentifiers: Object.keys(identities.identities).length,
  ambiguousMappingsExcluded: identities.ambiguous,
  rejections: rejected,
  packs: counts,
};
const images = mediaSnapshotSchema.parse({
  version: 1,
  retrievedAt: source.retrievedAt,
  movies: Object.fromEntries(movies.map((m) => [m.id, media.get(m.id)])),
});
await writeFile("data/media.json.tmp", `${JSON.stringify(images)}\n`);
await rename("data/media.json.tmp", "data/media.json");
await writeFile("data/catalog.json.tmp", `${JSON.stringify(snapshot)}\n`);
await rename("data/catalog.json.tmp", "data/catalog.json");
await writeFile("data/catalog-report.json", `${JSON.stringify(report, null, 2)}\n`);
await writeFile(resolve(directory, "normalized.json"), JSON.stringify(normalized));
console.log(
  JSON.stringify({ ...report, rejections: rejected.length, packs: counts.popular }, null, 2),
);
await pool.end();
