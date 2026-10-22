import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { dailyPoolSchema, MIN_DAILY_VOTES } from "../../apps/api/src/daily.ts";
import type { Movie } from "../../packages/game-engine/src/model.ts";
import { readSnapshot } from "./snapshot.ts";

const candidatesSchema = z.object({
  retrievedAt: z.iso.date(),
  movies: z.array(
    z.object({ id: z.number().int().positive(), vote_count: z.number().int().nonnegative() }),
  ),
});
export function buildDailyPool(movies: Movie[], raw: unknown) {
  const candidates = candidatesSchema.parse(raw);
  const votes = new Map(candidates.movies.map((m) => [String(m.id), m.vote_count]));
  const entries = movies
    .flatMap((m) => {
      const ids = new Set(
        m.provenance
          .filter((p) => p.provider === "tmdb")
          .flatMap((p) => {
            const id = p.url.match(/^https:\/\/www\.themoviedb\.org\/movie\/(\d+)$/)?.[1];
            return id ? [id] : [];
          }),
      );
      // Ambiguous identities must not borrow the audience of a different film.
      if (ids.size !== 1) return [];
      const count = votes.get([...ids][0]) ?? 0;
      return count >= MIN_DAILY_VOTES ? [{ id: m.id, votes: count }] : [];
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  return dailyPoolSchema.parse({
    version: 1,
    retrievedAt: candidates.retrievedAt,
    provider: "tmdb",
    movies: entries,
  });
}
if (import.meta.main) {
  const directory = process.argv[2] ?? ".cache/catalog";
  const { movies } = await readSnapshot();
  const snapshot = buildDailyPool(
    movies,
    JSON.parse(await readFile(`${directory}/candidates.json`, "utf8")),
  );
  await writeFile("data/daily-pool.json", `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(
    `Daily audience snapshot: ${snapshot.movies.length} films with at least ${MIN_DAILY_VOTES} TMDB votes`,
  );
}
