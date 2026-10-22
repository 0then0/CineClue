import { readFile, rename, writeFile } from "node:fs/promises";
import { loadMovieMedia, mediaSnapshotSchema } from "../../apps/api/src/media.ts";
import type { Entity, MediaImage } from "../../packages/game-engine/src/model.ts";
import { snapshotSchema } from "./snapshot.ts";

// Reuse known logos by canonical studio ID, then look up missing Wikidata logos in batches.
const catalog = snapshotSchema.parse(JSON.parse(await readFile("data/catalog.json", "utf8")));
const snapshot = mediaSnapshotSchema.parse(JSON.parse(await readFile("data/media.json", "utf8")));
const logos: Record<string, MediaImage> = {};
for (const media of Object.values(snapshot.movies)) Object.assign(logos, media.studios);
const missing = new Map<string, Entity>();
for (const movie of catalog.movies)
  for (const studio of movie.studios)
    if (!logos[studio.id] && /^Q\d+$/.test(studio.id)) missing.set(studio.id, studio);
const studios = [...missing.values()];
const checked = new Set<string>();
for (let offset = 0; offset < studios.length; offset += 40) {
  const batch = studios.slice(offset, offset + 40);
  const media = await loadMovieMedia({
    ...catalog.movies[0],
    id: "studio-batch",
    externalIds: {},
    actors: [],
    directors: [],
    countries: [],
    studios: batch,
  });
  Object.assign(logos, media.studios);
  if (media.studioFallbackChecked) for (const studio of batch) checked.add(studio.id);
  console.log(`Checked ${Math.min(offset + 40, studios.length)}/${studios.length} missing studios`);
}
for (const movie of catalog.movies) {
  const media = snapshot.movies[movie.id];
  if (!media) continue;
  media.studios ??= {};
  for (const studio of movie.studios)
    if (logos[studio.id]) media.studios[studio.id] = logos[studio.id];
  media.studioFallbackChecked = movie.studios.every(
    (s) => !!media.studios?.[s.id] || !/^Q\d+$/.test(s.id) || checked.has(s.id),
  );
}
await writeFile("data/media.json.tmp", `${JSON.stringify(snapshot)}\n`);
await rename("data/media.json.tmp", "data/media.json");
console.log(
  `Available logos: ${Object.keys(logos).length}; Commons: ${Object.values(logos).filter((i) => i.provider === "commons").length}`,
);
