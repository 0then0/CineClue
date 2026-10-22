import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  type MediaImage,
  type Movie,
  type MovieMedia,
  movieMediaSchema,
} from "../../../packages/game-engine/src/model.ts";
import type { Catalog } from "./catalog.ts";

const claim = z.object({
  mainsnak: z.object({ datavalue: z.object({ value: z.unknown() }).optional() }),
});
const wikidata = z.object({
  entities: z.record(
    z.string(),
    z.object({ claims: z.record(z.string(), z.array(claim)).optional() }),
  ),
});
const metadata = z.object({ value: z.string() });
const commons = z.object({
  query: z.object({
    pages: z.record(
      z.string(),
      z.object({
        title: z.string(),
        imageinfo: z
          .array(
            z.object({
              thumburl: z.string().optional(),
              descriptionurl: z.string(),
              extmetadata: z.object({
                Artist: metadata.optional(),
                LicenseShortName: metadata.optional(),
                LicenseUrl: metadata.optional(),
              }),
            }),
          )
          .optional(),
      }),
    ),
  }),
});
const person = z.object({ id: z.number(), profile_path: z.string().nullable().optional() });
const tmdbMovie = z.object({
  poster_path: z.string().nullable().optional(),
  production_companies: z
    .array(z.object({ id: z.number(), logo_path: z.string().nullable().optional() }))
    .default([]),
  credits: z.object({ cast: z.array(person), crew: z.array(person) }),
});
const empty = (): MovieMedia => ({ people: {}, countries: {} });
const plain = (s = "") =>
  s
    .replace(/<[^>]*>/g, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"');
function trustedUrl(value: string, hosts: string[]) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !hosts.includes(url.hostname))
    throw new Error("Untrusted media URL");
  url.search = "";
  return url.href;
}
async function request(url: URL | string, token?: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "CineClue/0.1 (open-source film game)",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(8000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Media provider HTTP ${response.status}`);
  return response.json();
}
export function tmdbImage(path: string | null | undefined, source: string): MediaImage | undefined {
  if (!path || !/^\/[a-zA-Z0-9_.-]+$/.test(path)) return;
  return {
    url: `https://image.tmdb.org/t/p/w185${path}`,
    source,
    author: "TMDB contributors",
    license: "TMDB terms",
    licenseUrl: "https://www.themoviedb.org/terms-of-use",
    provider: "tmdb",
  };
}

export async function loadMovieMedia(
  movie: Movie,
  token?: string,
  stored: MovieMedia = empty(),
): Promise<MovieMedia> {
  const result = {
    ...stored,
    studios: stored.studios ? { ...stored.studios } : undefined,
    people: { ...stored.people },
    countries: { ...stored.countries },
  };
  const people = [...movie.directors, ...movie.actors];
  if (
    result.studios !== undefined &&
    (result.studioFallbackChecked || movie.studios.every((s) => result.studios?.[s.id])) &&
    result.poster &&
    people.every((p) => result.people[p.id])
  )
    return result;
  const ids = [
    ...new Set(
      [
        movie.id,
        ...people.map((p) => p.id),
        ...movie.countries.map((c) => c.id),
        ...movie.studios.filter((s) => !result.studios?.[s.id]).map((s) => s.id),
      ].filter((id) => /^Q\d+$/.test(id)),
    ),
  ];
  let entities: z.infer<typeof wikidata>["entities"] = {};
  let entitiesLoaded = false;
  try {
    if (ids.length) {
      const url = new URL("https://www.wikidata.org/w/api.php");
      url.search = new URLSearchParams({
        action: "wbgetentities",
        format: "json",
        props: "claims",
        ids: ids.join("|"),
      }).toString();
      entities = wikidata.parse(await request(url)).entities;
      entitiesLoaded = true;
    }
  } catch {
    /* Media must never prevent playing. */
  }
  const value = (id: string, property: string) => {
    const v = entities[id]?.claims?.[property]?.[0]?.mainsnak.datavalue?.value;
    return typeof v === "string" ? v : undefined;
  };
  for (const country of movie.countries) {
    const iso = country.id.startsWith("iso:") ? country.id.slice(4) : value(country.id, "P297");
    if (iso && /^[A-Z]{2}$/.test(iso)) result.countries[country.id] = iso;
  }
  if (token) {
    const id =
      movie.externalIds.tmdb ?? movie.id.match(/^tmdb:(\d+)$/)?.[1] ?? value(movie.id, "P4947");
    if (id && /^\d+$/.test(id)) {
      try {
        const data = tmdbMovie.parse(
          await request(
            `https://api.themoviedb.org/3/movie/${id}?append_to_response=credits`,
            token,
          ),
        );
        result.studios ??= {};
        for (const company of data.production_companies) {
          const id = `tmdb:studio:${company.id}`;
          const image = tmdbImage(
            company.logo_path,
            `https://www.themoviedb.org/company/${company.id}`,
          );
          if (movie.studios.some((s) => s.id === id) && image) result.studios[id] ??= image;
        }
        result.poster ??= tmdbImage(data.poster_path, `https://www.themoviedb.org/movie/${id}`);
        for (const p of people) {
          const personId = p.id.match(/^tmdb:person:(\d+)$/)?.[1] ?? value(p.id, "P4985");
          const entry = [...data.credits.cast, ...data.credits.crew].find(
            (c) => String(c.id) === personId,
          );
          const image = tmdbImage(
            entry?.profile_path,
            `https://www.themoviedb.org/person/${personId}`,
          );
          if (image) result.people[p.id] ??= image;
        }
      } catch {
        /* Fall back to licensed Commons media. */
      }
    }
  }
  const studioIds = new Set(movie.studios.map((s) => s.id));
  const files = new Map<string, string[]>();
  for (const id of [movie.id, ...people.map((p) => p.id), ...studioIds]) {
    if ((id === movie.id && result.poster) || result.people[id] || result.studios?.[id]) continue;
    const file = value(id, studioIds.has(id) ? "P154" : "P18");
    if (file && !file.includes("|") && file.length < 240) {
      const title = `File:${file.replaceAll("_", " ")}`;
      files.set(title, [...(files.get(title) ?? []), id]);
    }
  }
  if (files.size) {
    try {
      const url = new URL("https://commons.wikimedia.org/w/api.php");
      url.search = new URLSearchParams({
        action: "query",
        format: "json",
        prop: "imageinfo",
        iiprop: "url|extmetadata",
        iiurlwidth: "185",
        titles: [...files.keys()].join("|"),
      }).toString();
      const pages = commons.parse(await request(url)).query.pages;
      if (entitiesLoaded) result.studioFallbackChecked = true;
      for (const page of Object.values(pages)) {
        const info = page.imageinfo?.[0];
        if (!info?.thumburl) continue;
        const license = plain(info.extmetadata.LicenseShortName?.value);
        if (!/^(CC BY(?:-SA)? [\d.]+|CC0(?: [\d.]+)?|Public domain|PD.*)$/.test(license)) continue;
        const author = plain(info.extmetadata.Artist?.value).trim();
        if (license.startsWith("CC BY") && !author) continue;
        const image: MediaImage = {
          url: trustedUrl(info.thumburl, ["upload.wikimedia.org", "thumb.wikimedia.org"]),
          source: trustedUrl(info.descriptionurl, ["commons.wikimedia.org"]),
          author: author || "Wikimedia Commons",
          license,
          licenseUrl: trustedUrl(info.extmetadata.LicenseUrl?.value || info.descriptionurl, [
            "creativecommons.org",
            "commons.wikimedia.org",
          ]),
          provider: "commons",
        };
        for (const id of files.get(page.title) ?? []) {
          if (studioIds.has(id)) {
            result.studios ??= {};
            result.studios[id] = image;
          } else if (id === movie.id) result.poster = image;
          else result.people[id] = image;
        }
      }
    } catch {
      /* Missing files or providers leave readable placeholders. */
    }
  }
  if (!files.size && entitiesLoaded) result.studioFallbackChecked = true;
  return result;
}

// Coalesce duplicate requests, bound upstream concurrency/queue and cache failures briefly.
export class MediaCatalog {
  private cache = new Map<string, { expires: number; value: Promise<MovieMedia> }>();
  private active = 0;
  private queue: (() => void)[] = [];
  private catalog: Catalog;
  private token: string | undefined;
  private stored: Record<string, MovieMedia>;
  constructor(
    catalog: Catalog,
    token = process.env.TMDB_API_TOKEN,
    stored: Record<string, MovieMedia> = {},
  ) {
    this.stored = stored;
    this.catalog = catalog;
    this.token = token;
  }
  get(id: string): Promise<MovieMedia> | undefined {
    const movie = this.catalog.byId.get(id);
    if (!movie) return;
    const stored = this.stored[id];
    if (
      stored?.studios !== undefined &&
      (stored.studioFallbackChecked || movie.studios.every((s) => stored.studios?.[s.id])) &&
      stored.poster &&
      [...movie.directors, ...movie.actors].every((p) => stored.people[p.id])
    )
      return Promise.resolve(stored);
    const cached = this.cache.get(id);
    if (cached && cached.expires > Date.now()) return cached.value;
    if (this.active >= 2 && this.queue.length >= 12) return Promise.resolve(empty());
    const entry = { expires: Date.now() + 60000, value: Promise.resolve(empty()) };
    entry.value = new Promise<void>((resolve) => {
      if (this.active < 2) {
        this.active++;
        resolve();
      } else this.queue.push(resolve);
    }).then(async () => {
      try {
        const media = await loadMovieMedia(movie, this.token, this.stored[id]);
        entry.expires =
          Date.now() +
          (media.poster ||
          Object.keys(media.people).length ||
          Object.keys(media.studios ?? {}).length
            ? 86400000
            : 900000);
        return media;
      } catch {
        return empty();
      } finally {
        const next = this.queue.shift();
        if (next) next();
        else this.active--;
      }
    });
    this.cache.set(id, entry);
    return entry.value;
  }
}

export const mediaSnapshotSchema = z.object({
  version: z.literal(1),
  retrievedAt: z.iso.date(),
  movies: z.record(z.string(), movieMediaSchema),
});
export async function readMediaSnapshot(
  path: string | URL = new URL("../../../data/media.json", import.meta.url),
) {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  return mediaSnapshotSchema.parse(JSON.parse(raw)).movies;
}
