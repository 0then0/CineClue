import { countryKey } from "./countries.ts";
import type { Comparison, Entity, Movie, NumericResult, SetResult } from "./model.ts";

export * from "./model.ts";
export const DEFAULT_THRESHOLDS = { year: 3, runtime: 10 };
export function compareNumber(guess: number, target: number, close: number): NumericResult {
  const delta = target - guess;
  return {
    value: guess,
    status: delta === 0 ? "exact" : Math.abs(delta) <= close ? "close" : "miss",
    direction: delta === 0 ? null : delta > 0 ? "higher" : "lower",
  };
}
export function compareSet(
  guess: Entity[],
  target: Entity[],
  key: (entity: Entity) => string = (entity) => entity.id,
): SetResult {
  const targetIds = new Set(target.map(key));
  const unique = [...new Map(guess.map((x) => [key(x), x])).values()];
  const matches = unique.filter((x) => targetIds.has(key(x)));
  return {
    values: unique,
    matches,
    status:
      matches.length === 0
        ? "miss"
        : matches.length === unique.length && matches.length === targetIds.size
          ? "exact"
          : "partial",
  };
}
export function compareMovies(
  guess: Movie,
  target: Movie,
  thresholds = DEFAULT_THRESHOLDS,
): Comparison {
  return {
    year: compareNumber(guess.releaseYear, target.releaseYear, thresholds.year),
    runtime: compareNumber(guess.runtime, target.runtime, thresholds.runtime),
    directors: compareSet(guess.directors, target.directors),
    genres: target.genreProfile
      ? {
          ...compareSet(guess.genres, target.genres),
          ...(guess.subgenres?.length
            ? {
                subgenres: compareSet(guess.subgenres, target.subgenres ?? []),
                subgenresComparable: !!target.subgenres?.length,
              }
            : {}),
        }
      : compareSet(guess.genreProfile?.legacy ?? guess.genres, target.genres),
    actors: compareSet(guess.actors, target.actors),
    countries: compareSet(guess.countries, target.countries, countryKey),
    studios: compareSet(guess.studios, target.studios),
  };
}
function score(movie: Movie, links: number) {
  const completeness =
    [
      movie.actors.length >= 3,
      movie.directors.length > 0,
      movie.studios.length > 0,
      movie.genres.length > 0,
      movie.runtime > 0,
    ].filter(Boolean).length / 5;
  const guessabilityScore = Math.round(
    100 *
      (completeness * 0.35 + Math.min(links / 12, 1) * 0.45 + (movie.popularityScore / 100) * 0.2),
  );
  return { guessabilityScore, difficultyScore: 100 - guessabilityScore, links };
}
export function scoreCatalog(catalog: Movie[]) {
  const people = new Map<string, Set<string>>();
  for (const m of catalog)
    for (const p of [...m.actors, ...m.directors]) {
      const links = people.get(p.id) ?? new Set<string>();
      links.add(m.id);
      people.set(p.id, links);
    }
  return new Map(
    catalog.map((m) => {
      const neighbors = new Set<string>();
      for (const p of [...m.actors, ...m.directors])
        for (const id of people.get(p.id) ?? []) neighbors.add(id);
      neighbors.delete(m.id);
      return [m.id, score(m, neighbors.size)];
    }),
  );
}
export function qualityScores(movie: Movie, catalog: Movie[]) {
  return scoreCatalog(catalog).get(movie.id) ?? score(movie, 0);
}
