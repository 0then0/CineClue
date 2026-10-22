import { z } from "zod";
import { normalizeCountry } from "../../../packages/game-engine/src/countries.ts";
import { genreIn } from "../../../packages/game-engine/src/genres.ts";
import {
  type Difficulty,
  type Movie,
  movieSchema,
  type qualityScores,
  scoreCatalog,
} from "../../../packages/game-engine/src/index.ts";
import { createSearch } from "../../../packages/game-engine/src/search.ts";
import { MIN_DAILY_VOTES, readDailyPool } from "./daily.ts";
import { pool } from "./db.ts";
export const packSchema = z.object({
  id: z.string(),
  name: z.record(z.string(), z.string()),
  description: z.record(z.string(), z.string()),
  rules: z.object({
    genreIds: z.array(z.string()).optional(),
    directorIds: z.array(z.string()).optional(),
    countryIds: z.array(z.string()).optional(),
    yearMin: z.number().optional(),
    yearMax: z.number().optional(),
    movieIds: z.array(z.string()).optional(),
  }),
});
export type Pack = z.infer<typeof packSchema>;
export function inPack(m: Movie, p: Pack) {
  const r = p.rules;
  return (
    (!r.genreIds || genreIn(m, r.genreIds)) &&
    (!r.directorIds || m.directors.some((x) => r.directorIds?.includes(x.id))) &&
    (!r.countryIds || m.countries.some((x) => r.countryIds?.includes(x.id))) &&
    (!r.yearMin || m.releaseYear >= r.yearMin) &&
    (!r.yearMax || m.releaseYear <= r.yearMax) &&
    (!r.movieIds || r.movieIds.includes(m.id))
  );
}
export class Catalog {
  readonly byId: Map<string, Movie>;
  readonly search: ReturnType<typeof createSearch>;
  readonly scores: Map<string, ReturnType<typeof qualityScores>>;
  readonly movies: Movie[];
  readonly packs: Pack[];
  readonly sources: string[];
  readonly dailyVotes: ReadonlyMap<string, number>;
  constructor(movies: Movie[], packs: Pack[], dailyVotes: ReadonlyMap<string, number> = new Map()) {
    this.dailyVotes = dailyVotes;
    const frequency = new Map<string, number>();
    for (const m of movies)
      for (const g of [...m.genres, ...(m.subgenres ?? [])])
        frequency.set(g.id, (frequency.get(g.id) ?? 0) + 1);
    movies = movies.map((m) => ({
      ...m,
      countries: m.countries.map(normalizeCountry),
      genres: m.genres.map((g) => ({ ...g, frequency: frequency.get(g.id) })),
      subgenres: m.subgenres?.map((g) => ({ ...g, frequency: frequency.get(g.id) })),
    }));
    this.movies = movies;
    this.sources = [...new Set(movies.flatMap((m) => m.provenance.map((p) => p.provider)))].sort();
    this.packs = packs;
    if (!movies.length) throw new Error("Empty catalog. Run pnpm db:seed.");
    this.byId = new Map(movies.map((m) => [m.id, m]));
    this.search = createSearch(movies);
    this.scores = scoreCatalog(movies);
  }
  dailyCandidates() {
    return this.movies
      .filter((m) => {
        const score = this.scores.get(m.id);
        return (
          (this.dailyVotes.get(m.id) ?? 0) >= MIN_DAILY_VOTES &&
          !!score &&
          score.links >= 12 &&
          score.guessabilityScore >= 75 &&
          m.actors.length >= 3 &&
          m.directors.length > 0 &&
          m.genres.length > 0 &&
          m.countries.length > 0 &&
          m.studios.length > 0 &&
          m.runtime > 0
        );
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  candidates(difficulty: Difficulty, pack = "popular") {
    const p = this.packs.find((x) => x.id === pack);
    if (!p) return [];
    return this.movies
      .filter((m) => {
        const s = this.scores.get(m.id);
        if (!s || !inPack(m, p) || s.links < 1 || m.actors.length < 3) return false;
        // Cast-only enrichment does not replace the original popularity metric.
        const imported = m.provenance[0]?.provider === "tmdb";
        return difficulty === "easy"
          ? s.guessabilityScore >= 75 && s.links >= 4 && (!imported || m.popularityScore >= 60)
          : difficulty === "normal"
            ? s.guessabilityScore >= 60 && (!imported || m.popularityScore >= 35)
            : s.guessabilityScore >= 45;
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}
export async function loadCatalog() {
  const { rows } = await pool.query(`SELECT m.*,
 COALESCE((SELECT jsonb_agg(name) FROM alias WHERE movie_id=m.id),'[]') aliases,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'names',p.names) ORDER BY mp.position) FROM movie_person mp JOIN person p ON p.id=mp.person_id WHERE movie_id=m.id AND role='director'),'[]') directors,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'names',p.names) ORDER BY mp.position) FROM movie_person mp JOIN person p ON p.id=mp.person_id WHERE movie_id=m.id AND role='actor'),'[]') actors,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'names',e.names) ORDER BY e.id) FROM movie_genre r JOIN genre e ON e.id=r.entity_id WHERE movie_id=m.id),'[]') genres,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'names',e.names) ORDER BY e.id) FROM movie_country r JOIN country e ON e.id=r.entity_id WHERE movie_id=m.id),'[]') countries,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'names',e.names) ORDER BY e.id) FROM movie_studio r JOIN studio e ON e.id=r.entity_id WHERE movie_id=m.id),'[]') studios FROM movie m`);
  const movies = rows.map((r) =>
    movieSchema.parse({
      ...r,
      genreProfile: r.genre_profile ?? undefined,
      genres: r.genres.filter((g: { id: string }) => !g.id.startsWith("subgenre:")),
      subgenres: r.genres.filter((g: { id: string }) => g.id.startsWith("subgenre:")),
      originalTitle: r.original_title,
      releaseYear: r.release_year,
      externalIds: r.external_ids,
      popularityScore: r.popularity_score,
    }),
  );
  return new Catalog(
    movies,
    z
      .array(packSchema)
      .parse((await pool.query("SELECT * FROM content_pack ORDER BY (id='popular') DESC,id")).rows),
    await readDailyPool(),
  );
}
