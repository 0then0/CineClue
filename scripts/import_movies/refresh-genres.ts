import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Catalog } from "../../apps/api/src/catalog.ts";
import { pool } from "../../apps/api/src/db.ts";
import { applyGenreProfile } from "../../packages/game-engine/src/genres.ts";
import type { Movie } from "../../packages/game-engine/src/model.ts";
import { readJsonLines } from "./json-lines.ts";
import { mapConcurrent, TmdbClient } from "./providers/tmdb-client.ts";
import { preservesSeed, snapshotSchema } from "./snapshot.ts";

const directory = resolve(process.argv[2] ?? ".cache/catalog");
const snapshot = snapshotSchema.parse(JSON.parse(await readFile("data/catalog.json", "utf8")));
const identities = JSON.parse(await readFile(resolve(directory, "identities.json"), "utf8"));
const byId = new Map(snapshot.movies.map((m) => [m.id, m]));
const updated = new Set<string>();
const keywordInputs: { id: string; tmdb: number; genres: unknown }[] = [];
for await (const raw of readJsonLines(resolve(directory, "details.jsonl"))) {
  const key = `tmdb:${(raw as { id: number }).id}`;
  const id = identities.identities[key] ?? key;
  const movie = byId.get(id);
  if (!movie) continue;
  byId.set(id, applyGenreProfile(movie, raw));
  keywordInputs.push({
    id,
    tmdb: (raw as { id: number }).id,
    genres: (raw as { genres: unknown }).genres,
  });
  updated.add(id);
}
if (updated.size !== snapshot.movies.length)
  throw Error(`Incomplete genre refresh: ${updated.size}/${snapshot.movies.length}`);
if (process.argv.includes("--keywords")) {
  const token = process.env.TMDB_API_TOKEN;
  if (!token) throw Error("TMDB_API_TOKEN is required for keyword refresh");
  const client = new TmdbClient(token, resolve(directory, "keyword-responses"));
  let completed = 0;
  await mapConcurrent(keywordInputs, async (item) => {
    const keywords = await client.get(`movie/${item.tmdb}/keywords`);
    const movie = byId.get(item.id);
    if (!movie) throw Error("Missing film");
    byId.set(item.id, applyGenreProfile(movie, { genres: item.genres, keywords }));
    completed++;
    if (completed % 250 === 0) console.log(`Keywords: ${completed}/${keywordInputs.length}`);
  });
}
snapshot.movies = snapshot.movies.map((m) => byId.get(m.id) as Movie);
const source = JSON.parse(await readFile("data/seed/movies.json", "utf8")) as Movie[];
for (const m of source)
  if (!preservesSeed(m, byId.get(m.id))) throw Error(`Unexpected seed change: ${m.id}`);
const catalog = new Catalog(snapshot.movies, snapshot.packs);
const report = JSON.parse(await readFile("data/catalog-report.json", "utf8"));
report.packs = Object.fromEntries(
  catalog.packs.map((p) => [
    p.id,
    Object.fromEntries(
      (["easy", "normal", "hard"] as const).map((d) => [d, catalog.candidates(d, p.id).length]),
    ),
  ]),
);
report.genres = {
  version: 1,
  baseGenres: new Set(snapshot.movies.flatMap((m) => m.genres.map((g) => g.id))).size,
  filmsWithSubgenres: snapshot.movies.filter((m) => m.subgenres?.length).length,
};
await writeFile("data/catalog.json.tmp", `${JSON.stringify(snapshot)}\n`);
await rename("data/catalog.json.tmp", "data/catalog.json");
await writeFile("data/catalog-report.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(report.genres);
await pool.end();
