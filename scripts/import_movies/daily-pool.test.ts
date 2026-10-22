import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { Movie } from "../../packages/game-engine/src/model.ts";
import { buildDailyPool } from "./build-daily-pool.ts";

it("uses explicit TMDB identities and vote counts, never mixed popularity metrics or title matching", () => {
  const base: Movie = JSON.parse(readFileSync("data/catalog.json", "utf8")).movies[0];
  const make = (id: string, tmdbIds: number[]) => ({
    ...base,
    id,
    popularityScore: 100,
    provenance: tmdbIds.map((n) => ({
      provider: "tmdb" as const,
      url: `https://www.themoviedb.org/movie/${n}`,
      retrievedAt: "2026-10-21",
      license: "TMDB-terms" as const,
    })),
  });
  const snapshot = buildDailyPool(
    [make("popular", [1]), make("obscure", [2]), make("unverified", []), make("ambiguous", [1, 3])],
    {
      retrievedAt: "2026-10-21",
      movies: [
        { id: 1, vote_count: 5000 },
        { id: 2, vote_count: 4999 },
        { id: 3, vote_count: 9000 },
      ],
    },
  );
  expect(snapshot.movies).toEqual([{ id: "popular", votes: 5000 }]);
});
