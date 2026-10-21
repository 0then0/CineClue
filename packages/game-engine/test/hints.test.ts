import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createHint, hintAllowance } from "../src/hints.ts";
import { compareMovies } from "../src/index.ts";
import { movieSchema, publicMovie } from "../src/model.ts";

const movies = JSON.parse(
  readFileSync(new URL("../../../data/seed/movies.json", import.meta.url), "utf8"),
).map((m: unknown) => movieSchema.parse(m));
const target = movies[0];
it("unlocks exactly one hint at three misses and a second at seven", () => {
  expect([0, 1, 2, 3, 4, 6, 7, 8].map(hintAllowance)).toEqual([0, 0, 0, 1, 1, 1, 2, 2]);
});
it("reveals only the chosen attribute and prefers an actor not already matched", () => {
  const guessed = { ...target, id: "guess", actors: [target.actors[0]] };
  const guesses = [{ movie: publicMovie(guessed), comparison: compareMovies(guessed, target) }];
  const actor = createHint("actor", target, movies, guesses);
  expect(actor).toEqual({ kind: "actor", values: [target.actors[1]] });
  expect(actor).not.toHaveProperty("movie");
  expect(actor).not.toHaveProperty("title");
  expect(createHint("decade", target, movies, [])).toEqual({
    kind: "decade",
    decade: Math.floor(target.releaseYear / 10) * 10,
  });
  const genres = createHint("genres", target, movies, []);
  expect(genres && "values" in genres ? genres.values.length : 0).toBeLessThanOrEqual(2);
});
it("excludes the target from filmography and returns no fabricated related film", () => {
  const related = { ...target, id: "related", title: "Another film" };
  expect(createHint("filmography", target, [target, related], [])).toEqual({
    kind: "filmography",
    movies: [publicMovie(related)],
  });
  expect(createHint("filmography", target, [target], [])).toBeNull();
});
