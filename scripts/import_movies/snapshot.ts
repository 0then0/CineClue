import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { packSchema } from "../../apps/api/src/catalog.ts";
import { baseGenres, subgenreDefinitions } from "../../packages/game-engine/src/genres.ts";
import { type Movie, movieSchema } from "../../packages/game-engine/src/model.ts";

export const snapshotSchema = z.object({
  version: z.literal(1),
  retrievedAt: z.iso.date(),
  movies: z.array(movieSchema).min(1),
  packs: z.array(packSchema).min(1),
});
export function preservesSeed(base: Movie, enriched: Movie | undefined) {
  if (!enriched) return false;
  if (isDeepStrictEqual(base, enriched)) return true;
  const added = enriched.provenance.slice(base.provenance.length);
  return (
    added.length === 1 &&
    added[0]?.provider === "tmdb" &&
    added[0]?.license === "TMDB-terms" &&
    /^https:\/\/www\.themoviedb\.org\/movie\/\d+$/.test(added[0].url) &&
    isDeepStrictEqual(enriched.provenance.slice(0, base.provenance.length), base.provenance) &&
    (enriched.genreProfile
      ? isDeepStrictEqual(enriched.genreProfile.legacy, base.genreProfile?.legacy ?? base.genres) &&
        enriched.genres.every((g) => [...baseGenres.values()].some((b) => b.id === g.id)) &&
        (enriched.subgenres ?? []).every((g) =>
          subgenreDefinitions.some(([id]) => g.id === `subgenre:${id}`),
        ) &&
        isDeepStrictEqual(
          {
            ...enriched,
            actors: base.actors,
            provenance: base.provenance,
            genres: base.genres,
            subgenres: undefined,
            genreProfile: undefined,
          },
          { ...base, subgenres: undefined, genreProfile: undefined },
        )
      : isDeepStrictEqual({ ...enriched, actors: base.actors, provenance: base.provenance }, base))
  );
}
export async function readSnapshot() {
  const movies = z
    .array(movieSchema)
    .parse(
      JSON.parse(await readFile(new URL("../../data/seed/movies.json", import.meta.url), "utf8")),
    );
  const packs = z
    .array(packSchema)
    .parse(
      JSON.parse(await readFile(new URL("../../data/seed/packs.json", import.meta.url), "utf8")),
    );
  let source: string;
  try {
    source = await readFile(new URL("../../data/catalog.json", import.meta.url), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { movies, packs };
    throw error;
  }
  const expanded = snapshotSchema.parse(JSON.parse(source));
  const byId = new Map(expanded.movies.map((movie) => [movie.id, movie]));
  if (byId.size !== expanded.movies.length) throw new Error("Duplicate expanded movie IDs");
  for (const movie of movies) {
    if (!preservesSeed(movie, byId.get(movie.id)))
      throw new Error(`Expanded catalog changed or removed original film ${movie.id}`);
  }
  return { movies: expanded.movies, packs: expanded.packs };
}
