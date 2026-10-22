import { z } from "zod";
import { tmdbImage } from "../../apps/api/src/media.ts";
import {
  historicalCountryCodes,
  normalizeCountry,
} from "../../packages/game-engine/src/countries.ts";
import { applyGenreProfile } from "../../packages/game-engine/src/genres.ts";
import {
  type Entity,
  type Movie,
  type MovieMedia,
  movieSchema,
} from "../../packages/game-engine/src/model.ts";
import type { IdentityData } from "./identities.ts";
import { TmdbProvider } from "./providers/tmdb.ts";

export const candidateSchema = z.object({
  id: z.number().int().positive(),
  vote_count: z.number().nonnegative(),
  original_language: z.string(),
  genre_ids: z.array(z.number()),
  release_date: z.string(),
  popularity: z.number(),
});
export type Candidate = z.infer<typeof candidateSchema>;
export function popularity(votes: number) {
  return Math.min(100, Math.round(20 * Math.log10(1 + Math.max(0, votes))));
}
export async function normalizeExpanded(
  raw: unknown,
  candidate: Candidate,
  data: IdentityData,
): Promise<Movie> {
  const r = raw as Record<string, unknown>;
  if (r.adult === true || r.video === true || r.status !== "Released")
    throw new Error("not_released_feature");
  if (typeof r.runtime !== "number" || r.runtime < 40 || r.runtime > 400)
    throw new Error("runtime_out_of_range");
  if (candidate.release_date > new Date().toISOString().slice(0, 10))
    throw new Error("future_release");
  const translations = r.translations as { translations?: { iso_639_1: string }[] } | undefined;
  const alternative = r.alternative_titles as { titles?: { iso_3166_1: string }[] } | undefined;
  const [normalized] = await new TmdbProvider([]).normalize([
    {
      ...r,
      translations: {
        translations: (translations?.translations ?? []).filter((t) =>
          ["en", "ru", candidate.original_language].includes(t.iso_639_1),
        ),
      },
      alternative_titles: {
        titles: (alternative?.titles ?? []).filter((t) =>
          ["US", "GB", "RU"].includes(t.iso_3166_1),
        ),
      },
    },
  ]);
  if (!normalized || normalized.actors.length < 3) throw new Error("incomplete_cast");
  const canonical = (entity: Entity): Entity => {
    const sourceCountryCode = entity.id.match(/^iso:([A-Z]{2})$/)?.[1];
    if (sourceCountryCode && historicalCountryCodes.has(sourceCountryCode))
      return normalizeCountry(entity);
    const id = data.identities[entity.id] ?? entity.id;
    const known = data.entities[id];
    const country = entity.id.match(/^iso:([A-Z]{2})$/)?.[1];
    return known
      ? { ...known, names: { ...entity.names, ...known.names } }
      : country
        ? {
            ...entity,
            id,
            names: {
              en: entity.name,
              ru: new Intl.DisplayNames(["ru"], { type: "region" }).of(country) ?? entity.name,
            },
          }
        : { ...entity, id };
  };
  for (const key of ["actors", "directors", "genres", "countries", "studios"] as const)
    normalized[key] = [
      ...new Map(
        normalized[key].map((e) => {
          const value = canonical(e);
          return [value.id, value];
        }),
      ).values(),
    ];
  if (normalized.actors.length < 3) throw new Error("incomplete_canonical_cast");
  return applyGenreProfile(
    movieSchema.parse({ ...normalized, popularityScore: popularity(candidate.vote_count) }),
    raw,
  );
}
export function selectExpanded(
  base: Movie[],
  normalized: Movie[],
  candidates: Candidate[],
  target = 10000,
) {
  const info = new Map(candidates.map((c) => [`tmdb:${c.id}`, c]));
  const sorted = [...normalized].sort(
    (a, b) =>
      (info.get(b.id)?.vote_count ?? 0) - (info.get(a.id)?.vote_count ?? 0) ||
      a.id.localeCompare(b.id),
  );
  const selected = new Map(base.map((m) => [m.id, m]));
  const add = (movies: Movie[], limit: number) => {
    let count = 0;
    for (const movie of movies) {
      if (selected.size >= target || count >= limit) break;
      if (selected.has(movie.id)) continue;
      selected.set(movie.id, movie);
      count++;
    }
  };
  add(
    sorted.filter((m) => info.get(m.id)?.original_language === "ru"),
    300,
  );
  add(
    sorted.filter((m) => info.get(m.id)?.genre_ids.includes(16)),
    400,
  );
  add(
    sorted.filter((m) => m.releaseYear < 1970),
    400,
  );
  add(
    [...sorted]
      .filter((m) => m.releaseYear >= new Date().getUTCFullYear() - 1)
      .sort((a, b) => (info.get(b.id)?.popularity ?? 0) - (info.get(a.id)?.popularity ?? 0)),
    150,
  );
  add(sorted, target);
  if (selected.size < target)
    throw new Error(
      `Only ${selected.size}/${target} complete unique films; gather more candidates before publication`,
    );
  return [...selected.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// Existing CC0 records keep their identities and facts; credited cast enrichment is separately attributed.
export function enrichSeedCast(
  base: Movie,
  raw: unknown,
  data: IdentityData,
  retrievedAt: string,
): Movie {
  const parsed = z
    .object({
      id: z.number().int().positive(),
      credits: z.object({
        cast: z.array(
          z.object({
            id: z.number().int().positive(),
            name: z.string().min(1),
            order: z.number().optional(),
          }),
        ),
      }),
    })
    .parse(raw);
  const actors = [
    ...new Map(
      [...parsed.credits.cast]
        .sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9))
        .map((p) => {
          const id = data.identities[`tmdb:person:${p.id}`] ?? `tmdb:person:${p.id}`;
          return [id, data.entities[id] ?? { id, name: p.name, names: { en: p.name } }];
        }),
    ).values(),
  ].slice(0, 5);
  if (actors.length < 3) throw new Error(`Insufficient credited cast for ${base.id}`);
  const enriched = movieSchema.parse({
    ...base,
    actors,
    provenance: [
      ...base.provenance,
      {
        provider: "tmdb",
        url: `https://www.themoviedb.org/movie/${parsed.id}`,
        license: "TMDB-terms",
        retrievedAt,
      },
    ],
  });
  return (raw as Record<string, unknown>).genres ? applyGenreProfile(enriched, raw) : enriched;
}

export function importedMedia(raw: unknown, movie: Movie, data: IdentityData) {
  const parsed = z
    .object({
      id: z.number(),
      poster_path: z.string().nullable().optional(),
      credits: z.object({
        cast: z.array(z.object({ id: z.number(), profile_path: z.string().nullable().optional() })),
        crew: z.array(z.object({ id: z.number(), profile_path: z.string().nullable().optional() })),
      }),
      production_companies: z
        .array(z.object({ id: z.number(), logo_path: z.string().nullable().optional() }))
        .default([]),
      production_countries: z.array(z.object({ iso_3166_1: z.string() })),
    })
    .parse(raw);
  const media: MovieMedia = { people: {}, countries: {}, studios: {} };
  const poster = tmdbImage(parsed.poster_path, `https://www.themoviedb.org/movie/${parsed.id}`);
  if (poster) media.poster = poster;
  const wanted = new Set([...movie.actors, ...movie.directors].map((p) => p.id));
  for (const p of [...parsed.credits.cast, ...parsed.credits.crew]) {
    const id = data.identities[`tmdb:person:${p.id}`] ?? `tmdb:person:${p.id}`;
    const image = tmdbImage(p.profile_path, `https://www.themoviedb.org/person/${p.id}`);
    if (wanted.has(id) && image) media.people[id] = image;
  }
  for (const company of parsed.production_companies) {
    const key = `tmdb:studio:${company.id}`;
    const id = data.identities[key] ?? key;
    const image = tmdbImage(company.logo_path, `https://www.themoviedb.org/company/${company.id}`);
    if (movie.studios.some((s) => s.id === id) && image && media.studios) media.studios[id] = image;
  }
  for (const c of parsed.production_countries) {
    const key = `iso:${c.iso_3166_1}`;
    const id = data.identities[key] ?? key;
    if (movie.countries.some((c) => c.id === id) && /^[A-Z]{2}$/.test(c.iso_3166_1))
      media.countries[id] = c.iso_3166_1;
  }
  return media;
}
