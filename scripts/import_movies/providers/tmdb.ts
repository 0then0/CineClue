import { z } from "zod";
import { type Movie, movieSchema } from "../../../packages/game-engine/src/index.ts";
import type { MovieProvider } from "./types.ts";

const localized = z.record(z.string(), z.string());
const named = z.object({ id: z.number(), name: z.string() });
const rawMovie = z.object({
  id: z.number(),
  title: z.string(),
  original_title: z.string(),
  release_date: z.string(),
  runtime: z.number(),
  popularity: z.number(),
  imdb_id: z.string().nullable(),
  genres: z.array(named),
  production_companies: z.array(named),
  production_countries: z.array(z.object({ iso_3166_1: z.string(), name: z.string() })),
  credits: z.object({ cast: z.array(named), crew: z.array(named.extend({ job: z.string() })) }),
  translations: z.object({
    translations: z.array(
      z.object({ iso_639_1: z.string(), data: z.object({ title: z.string() }) }),
    ),
  }),
  alternative_titles: z.object({ titles: z.array(z.object({ title: z.string() })) }),
});
export class TmdbProvider implements MovieProvider {
  readonly name = "tmdb";
  readonly ids: number[];
  constructor(ids: number[]) {
    this.ids = ids;
  }
  async load() {
    const token = process.env.TMDB_API_TOKEN;
    if (!token) throw new Error("TMDB_API_TOKEN is required, see TMDB terms before importing.");
    const out: unknown[] = [];
    for (const id of this.ids) {
      const u = `https://api.themoviedb.org/3/movie/${id}?append_to_response=credits,translations,alternative_titles`;
      const r = await fetch(u, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) throw new Error(`TMDB HTTP ${r.status}`);
      out.push(await r.json());
    }
    return out;
  }
  async normalize(raw: unknown[]): Promise<Movie[]> {
    return raw.map((value) => {
      const r = rawMovie.parse(value);
      const entity = (v: z.infer<typeof named>, kind: string) => ({
        id: `tmdb:${kind}:${v.id}`,
        name: v.name,
        names: { en: v.name },
      });
      const titles = localized.parse(
        Object.fromEntries(
          r.translations.translations
            .filter((t) => t.data.title)
            .map((t) => [t.iso_639_1, t.data.title]),
        ),
      );
      return movieSchema.parse({
        id: `tmdb:${r.id}`,
        title: r.title,
        originalTitle: r.original_title,
        titles,
        aliases: r.alternative_titles.titles.map((t) => t.title),
        releaseYear: Number(r.release_date.slice(0, 4)),
        runtime: r.runtime,
        directors: r.credits.crew
          .filter((p) => p.job === "Director")
          .map((p) => entity(p, "person")),
        actors: r.credits.cast.slice(0, 5).map((p) => entity(p, "person")),
        genres: r.genres.map((p) => entity(p, "genre")),
        studios: r.production_companies.map((p) => entity(p, "studio")),
        countries: r.production_countries.map((p) => ({
          id: `iso:${p.iso_3166_1}`,
          name: p.name,
          names: { en: p.name },
        })),
        externalIds: { tmdb: String(r.id), ...(r.imdb_id ? { imdb: r.imdb_id } : {}) },
        popularityScore: Math.min(100, r.popularity),
        provenance: [
          {
            provider: "tmdb",
            url: `https://www.themoviedb.org/movie/${r.id}`,
            license: "TMDB-terms",
            retrievedAt: new Date().toISOString().slice(0, 10),
          },
        ],
      });
    });
  }
}
