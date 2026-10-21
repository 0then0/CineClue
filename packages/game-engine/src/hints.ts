import { type GameHint, type GuessView, type HintKind, type Movie, publicMovie } from "./model.ts";
export function hintAllowance(misses: number) {
  return misses >= 7 ? 2 : misses >= 3 ? 1 : 0;
}
export function createHint(
  kind: HintKind,
  target: Movie,
  catalog: Movie[],
  guesses: GuessView[],
): GameHint | null {
  if (kind === "decade") return { kind, decade: Math.floor(target.releaseYear / 10) * 10 };
  if (kind === "actor") {
    const known = new Set(guesses.flatMap((g) => g.comparison.actors.matches.map((p) => p.id)));
    const actor = target.actors.find((p) => !known.has(p.id)) ?? target.actors[0];
    return actor ? { kind, values: [actor] } : null;
  }
  if (kind === "genres") {
    const known = new Set(guesses.flatMap((g) => g.comparison.genres.matches.map((p) => p.id)));
    const unknown = target.genres.filter((p) => !known.has(p.id));
    return target.genres.length
      ? { kind, values: (unknown.length ? unknown : target.genres).slice(0, 2) }
      : null;
  }
  const directors = new Set(target.directors.map((p) => p.id));
  const guessed = new Set(guesses.map((g) => g.movie.id));
  const related = catalog.filter(
    (m) => m.id !== target.id && m.directors.some((p) => directors.has(p.id)),
  );
  related.sort(
    (a, b) =>
      Number(guessed.has(a.id)) - Number(guessed.has(b.id)) ||
      b.popularityScore - a.popularityScore ||
      a.id.localeCompare(b.id),
  );
  return related.length ? { kind, movies: related.slice(0, 2).map(publicMovie) } : null;
}
