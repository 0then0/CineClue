import { expect, it } from "vitest";
import { applyGenreProfile, genreIn } from "../src/genres.ts";
import { compareMovies, type Movie } from "../src/index.ts";

const drama = { id: "Q130232", name: "dramatic film", names: {} };
const original: Movie = {
  id: "film",
  title: "Film",
  originalTitle: "Film",
  titles: {},
  aliases: [],
  releaseYear: 2000,
  runtime: 100,
  countries: [],
  genres: [drama, { id: "Q853630", name: "slasher film", names: {} }],
  actors: [],
  directors: [],
  studios: [],
  externalIds: {},
  provenance: [],
  popularityScore: 50,
};
it("uses short localized TMDB genres and separates curated source and keyword subgenres", () => {
  const before = structuredClone(original);
  const film = applyGenreProfile(original, {
    genres: [{ id: 18 }, { id: 53 }, { id: 18 }],
    keywords: { keywords: [{ name: "cyberpunk" }, { name: "a random dramatic plot" }] },
  });
  expect(film.genres.map((g) => g.names.ru)).toEqual(["Драма", "Триллер"]);
  expect(film.subgenres?.map((g) => g.id)).toEqual(["subgenre:slasher", "subgenre:cyberpunk"]);
  expect(film.genreProfile?.legacy).toEqual(original.genres);
  expect(original).toEqual(before);
  expect(() => applyGenreProfile(original, { genres: [{ id: 999999 }] })).toThrow(
    "Unknown TMDB genre",
  );
});
it("does not infer subgenres from overview text or broad genres", () => {
  const film = applyGenreProfile(
    { ...original, genres: [drama] },
    { genres: [{ id: 18 }], overview: "a cyberpunk psychological thriller" },
  );
  expect(film.subgenres).toEqual([]);
});
it("compares base genres and subgenres independently without leaking target-only tags", () => {
  const guess = applyGenreProfile(original, { genres: [{ id: 18 }] });
  const target = applyGenreProfile(
    { ...original, genres: [drama] },
    { genres: [{ id: 18 }], keywords: { keywords: [{ name: "coming of age" }] } },
  );
  const result = compareMovies(guess, target).genres;
  expect(result.status).toBe("exact");
  expect(result.subgenres?.status).toBe("miss");
  expect(result.subgenresComparable).toBe(true);
  expect(JSON.stringify(result)).not.toContain("coming-of-age");
  const unknown = compareMovies(guess, { ...target, subgenres: [] }).genres;
  expect(unknown.subgenresComparable).toBe(false);
});
it("preserves comparisons against the saved genre system of an existing game", () => {
  const updated = applyGenreProfile(original, { genres: [{ id: 27 }] });
  const result = compareMovies(updated, original).genres;
  expect(result.status).toBe("exact");
  expect(result.values).toEqual(original.genres);
  expect(result.subgenres).toBeUndefined();
});

it("preserves subgenre collection aliases without treating Music as a Musical", () => {
  const music = applyGenreProfile({ ...original, genres: [drama] }, { genres: [{ id: 10402 }] });
  expect(genreIn(music, ["Q842256"])).toBe(false);
  const musical = applyGenreProfile(
    { ...original, genres: [{ id: "Q842256", name: "musical film", names: {} }] },
    { genres: [{ id: 10402 }] },
  );
  expect(genreIn(musical, ["Q842256"])).toBe(true);
});
