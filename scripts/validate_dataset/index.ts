import { Catalog } from "../../apps/api/src/catalog.ts";
import { pool } from "../../apps/api/src/db.ts";
import { readMediaSnapshot } from "../../apps/api/src/media.ts";
import { readSnapshot } from "../import_movies/snapshot.ts";

const { movies, packs } = await readSnapshot();
if (new Set(movies.map((m) => m.id)).size !== movies.length) throw new Error("Duplicate movie IDs");
const catalog = new Catalog(movies, packs);
if (new Set(catalog.packs.map((pack) => pack.id)).size !== catalog.packs.length)
  throw new Error("Duplicate collection IDs");
for (const pack of catalog.packs) {
  for (const id of pack.rules.movieIds ?? [])
    if (!catalog.byId.has(id)) throw new Error(`Unknown film ${id} in collection ${pack.id}`);
  for (const difficulty of ["easy", "normal", "hard"] as const) {
    if (!catalog.candidates(difficulty, pack.id).length)
      throw new Error(`Empty collection ${pack.id} for ${difficulty}`);
  }
}
console.log(`Validated ${catalog.packs.length} collections on every difficulty`);
for (const difficulty of ["easy", "normal", "hard"] as const) {
  const candidates = catalog.candidates(difficulty);
  if (!candidates.length) throw new Error(`No candidates for ${difficulty}`);
  console.log(`${difficulty}: ${candidates.length} eligible targets`);
}
console.log(
  `Valid: ${movies.length} films; ${new Set(movies.flatMap((m) => m.countries.map((c) => c.id))).size} countries; ${Math.min(...movies.map((m) => m.releaseYear))}–${Math.max(...movies.map((m) => m.releaseYear))}`,
);
const images = await readMediaSnapshot();
for (const [id, media] of Object.entries(images)) {
  const movie = catalog.byId.get(id);
  if (!movie) throw new Error(`Unknown media film ${id}`);
  for (const studio of Object.keys(media.studios ?? {}))
    if (!movie.studios.some((s) => s.id === studio))
      throw new Error(`Unknown studio logo ${studio} in ${id}`);
  const people = new Set([...movie.actors, ...movie.directors].map((p) => p.id));
  for (const person of Object.keys(media.people))
    if (!people.has(person)) throw new Error(`Unknown portrait ${person} in ${id}`);
}
console.log(`Validated image metadata for ${Object.keys(images).length} films`);
await pool.end();
