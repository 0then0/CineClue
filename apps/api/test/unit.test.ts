import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { compareMovies } from "../../../packages/game-engine/src/index.ts";
import type { Movie } from "../../../packages/game-engine/src/model.ts";
import { Catalog, inPack, packSchema } from "../src/catalog.ts";
import { readDailyPool, selectDaily } from "../src/daily.ts";
import { dailyIndex, Games, nextMidnight, utcDate } from "../src/game.ts";

it("uses UTC and derives stable daily choices from a secret", () => {
  expect(utcDate(new Date("2026-10-22T01:59:00+03:00"))).toBe("2026-10-21");
  expect(nextMidnight("2026-12-31")).toBe("2027-01-01T00:00:00.000Z");
  expect(dailyIndex("2026-10-21", "secret", 500)).toBe(dailyIndex("2026-10-21", "secret", 500));
  expect(dailyIndex("2026-10-21", "other", 500)).not.toBe(dailyIndex("2026-10-21", "secret", 500));
});

// Media remains optional and never changes the game catalog or answer data.
it("loads attributed Commons images and ISO flags without TMDB credentials", async () => {
  const { loadMovieMedia } = await import("../src/media.ts");
  const movie = mediaMovie();
  const calls: string[] = [];
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    calls.push(url);
    return new Response(
      JSON.stringify(
        url.includes("wikidata.org")
          ? {
              entities: {
                Q1: { claims: { P18: [mediaClaim("Film.jpg")] } },
                Q2: { claims: { P18: [mediaClaim("Person.jpg")] } },
                Q30: { claims: { P297: [mediaClaim("US")] } },
              },
            }
          : {
              query: {
                pages: {
                  "1": mediaPage("Film.jpg"),
                  "2": mediaPage("Person.jpg"),
                },
              },
            },
      ),
    );
  });
  try {
    const result = await loadMovieMedia(movie);
    expect(result.poster?.provider).toBe("commons");
    expect(result.people.Q2.author).toBe("Test photographer");
    expect(result.people.Q2.license).toBe("CC BY-SA 4.0");
    expect(result.countries.Q30).toBe("US");
    expect(calls).toHaveLength(2);
    expect(calls.some((c) => c.includes("themoviedb"))).toBe(false);
  } finally {
    fetcher.mockRestore();
  }
});
it("ignores media with unknown rights or untrusted hosts and tolerates provider failures", async () => {
  const { loadMovieMedia } = await import("../src/media.ts");
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input) =>
      new Response(
        JSON.stringify(
          String(input).includes("wikidata.org")
            ? {
                entities: {
                  Q1: { claims: { P18: [mediaClaim("Film.jpg")] } },
                  Q2: { claims: { P18: [mediaClaim("Person.jpg")] } },
                },
              }
            : {
                query: {
                  pages: {
                    "1": mediaPage("Film.jpg", "All rights reserved"),
                    "2": mediaPage("Person.jpg", "CC BY-SA 4.0", "https://evil.example/image.jpg"),
                  },
                },
              },
        ),
      ),
  );
  try {
    const result = await loadMovieMedia(mediaMovie());
    expect(result.poster).toBeUndefined();
    expect(result.people).toEqual({});
    fetcher.mockRejectedValue(new Error("Offline"));
    expect(await loadMovieMedia(mediaMovie())).toEqual({ people: {}, countries: {} });
  } finally {
    fetcher.mockRestore();
  }
});
it("uses server-only TMDB credentials and matches portraits by provider ID", async () => {
  const { loadMovieMedia } = await import("../src/media.ts");
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("wikidata.org"))
      return new Response(
        JSON.stringify({
          entities: {
            Q1: { claims: { P4947: [mediaClaim("100")] } },
            Q2: { claims: { P4985: [mediaClaim("200")] } },
          },
        }),
      );
    expect(url).toBe("https://api.themoviedb.org/3/movie/100?append_to_response=credits");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-token");
    return new Response(
      JSON.stringify({
        poster_path: "/poster.jpg",
        credits: { cast: [{ id: 200, profile_path: "/portrait.jpg" }], crew: [] },
      }),
    );
  });
  try {
    const result = await loadMovieMedia(mediaMovie(), "test-token");
    expect(result.poster?.url).toBe("https://image.tmdb.org/t/p/w185/poster.jpg");
    expect(result.people.Q2.source).toBe("https://www.themoviedb.org/person/200");
    expect(JSON.stringify(result)).not.toContain("test-token");
  } finally {
    fetcher.mockRestore();
  }
});
it("coalesces media requests, bounds upstream concurrency and rejects unknown catalog IDs", async () => {
  const { MediaCatalog } = await import("../src/media.ts");
  const movies = [mediaMovie(), { ...mediaMovie(), id: "Q3" }, { ...mediaMovie(), id: "Q4" }];
  const catalog = new Catalog(movies, []);
  const media = new MediaCatalog(catalog);
  let active = 0,
    peak = 0;
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return new Response(JSON.stringify({ entities: {} }));
  });
  try {
    const first = media.get("Q1");
    expect(media.get("Q1")).toBe(first);
    expect(media.get("not-in-catalog")).toBeUndefined();
    await Promise.all([first, media.get("Q3"), media.get("Q4")]);
    expect(peak).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await media.get("Q1");
    expect(fetcher).toHaveBeenCalledTimes(3);
  } finally {
    fetcher.mockRestore();
  }
});
function mediaClaim(value: string) {
  return { mainsnak: { datavalue: { value } } };
}
function mediaPage(
  file: string,
  license = "CC BY-SA 4.0",
  url = "https://upload.wikimedia.org/test.jpg",
) {
  return {
    title: `File:${file}`,
    imageinfo: [
      {
        thumburl: url,
        descriptionurl: `https://commons.wikimedia.org/wiki/File:${file}`,
        extmetadata: {
          CommonsMetadataExtension: { value: 1 },
          Artist: { value: "<a>Test photographer</a>" },
          LicenseShortName: { value: license },
          LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" },
        },
      },
    ],
  };
}
function mediaMovie(): Movie {
  const entity = { id: "Q2", name: "Test person", names: {} };
  return {
    id: "Q1",
    title: "Test",
    originalTitle: "Test",
    titles: {},
    aliases: [],
    releaseYear: 2000,
    runtime: 100,
    directors: [entity],
    actors: [entity],
    genres: [],
    studios: [],
    countries: [{ id: "Q30", name: "United States", names: {} }],
    externalIds: {},
    popularityScore: 90,
    provenance: [],
  };
}

it("serves complete imported image metadata without provider calls or queue saturation", async () => {
  const { MediaCatalog, tmdbImage } = await import("../src/media.ts");
  const movie = mediaMovie();
  const stored = {
    studios: {},
    poster: tmdbImage("/poster.jpg", "https://www.themoviedb.org/movie/1"),
    people: { Q2: tmdbImage("/portrait.jpg", "https://www.themoviedb.org/person/2") },
    countries: { Q30: "US" },
  };
  const media = new MediaCatalog(
    new Catalog([movie], []),
    undefined,
    stored.poster && stored.people.Q2
      ? { Q1: { ...stored, poster: stored.poster, people: { Q2: stored.people.Q2 } } }
      : {},
  );
  const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("API unavailable"));
  try {
    const results = await Promise.all(Array.from({ length: 30 }, () => media.get("Q1")));
    expect(results.every((r) => r?.poster?.url.endsWith("/poster.jpg"))).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    fetcher.mockRestore();
  }
});

it("falls back to licensed Commons studio logos even when poster and cast are complete", async () => {
  const { loadMovieMedia, tmdbImage } = await import("../src/media.ts");
  const movie = { ...mediaMovie(), studios: [{ id: "Q10", name: "Studio", names: {} }] };
  const poster = tmdbImage("/poster.jpg", "https://www.themoviedb.org/movie/1");
  if (!poster) throw Error("Expected poster");
  const stored = { poster, people: { Q2: poster }, countries: {}, studios: {} };
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    return new Response(
      JSON.stringify(
        url.includes("wikidata.org")
          ? { entities: { Q10: { claims: { P154: [mediaClaim("Studio.svg")] } } } }
          : { query: { pages: { "1": mediaPage("Studio.svg", "Public domain") } } },
      ),
    );
  });
  try {
    const result = await loadMovieMedia(movie, undefined, stored);
    expect(result.studios?.Q10.provider).toBe("commons");
    expect(result.studios?.Q10.source).toContain("File:Studio.svg");
    expect(result.studioFallbackChecked).toBe(true);
    expect(stored.studios).toEqual({});
    expect(result.poster).toEqual(poster);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await loadMovieMedia(movie, undefined, result);
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {
    fetcher.mockRestore();
  }
});

it("requires verified audience and complete, connected clues for Daily independently of legacy popularity scores", () => {
  const entity = { id: "e", name: "Entity", names: {} };
  const complete = {
    ...mediaMovie(),
    actors: [entity, { ...entity, id: "a2" }, { ...entity, id: "a3" }],
    genres: [entity],
    studios: [entity],
    popularityScore: 5,
  };
  const movies = Array.from({ length: 14 }, (_, i) => ({ ...complete, id: `connected-${i}` }));
  const badCast = { ...complete, id: "bad-cast", actors: [entity] };
  const badStudio = { ...complete, id: "bad-studio", studios: [] };
  const isolated = {
    ...complete,
    id: "isolated",
    directors: [{ ...entity, id: "solo-director" }],
    actors: ["x", "y", "z"].map((id) => ({ ...entity, id })),
  };
  const obscure = { ...complete, id: "obscure", popularityScore: 100 };
  const all = [...movies, badCast, badStudio, isolated, obscure];
  const votes = new Map(all.map((m) => [m.id, m.id === "obscure" ? 4999 : 5000]));
  const catalog = new Catalog(all, [], votes);
  expect(catalog.dailyCandidates().map((m) => m.id)).toEqual(
    movies.map((m) => m.id).sort((a, b) => a.localeCompare(b)),
  );
  expect(new Catalog(all, []).dailyCandidates()).toEqual([]);
});

it("keeps recognizable classics and blockbusters in the separate Daily pool", async () => {
  const { movies, packs } = JSON.parse(readFileSync("data/catalog.json", "utf8"));
  const catalog = new Catalog(movies, packs, await readDailyPool());
  const ids = new Set(catalog.dailyCandidates().map((m) => m.id));
  expect(ids.size).toBeGreaterThan(365);
  for (const id of ["Q83495", "Q25188", "Q134773", "Q47703", "Q483815"])
    expect(ids.has(id), id).toBe(true);
});
it("avoids Daily repeats for 180 days and directors for seven days when alternatives exist", () => {
  const a = { ...mediaMovie(), id: "a" };
  const b = { ...a, id: "b" };
  const c = { ...a, id: "c", directors: [{ id: "other", name: "Other", names: {} }] };
  const recent = [{ date: "2026-10-21", movieId: "a", directorIds: ["Q2"] }];
  expect(selectDaily([a, b, c], recent, "2026-10-22", "secret")?.id).toBe("c");
  expect(selectDaily([a, b], recent, "2026-10-22", "secret")?.id).toBe("b");
  expect(selectDaily([a], [{ ...recent[0], date: "2026-04-25" }], "2026-10-22", "secret")).toBe(a);
});
it("chooses deterministically regardless of catalog/history order and ignores future history", () => {
  const movies = ["a", "b", "c"].map((id) => ({ ...mediaMovie(), id }));
  const recent = [{ date: "2026-10-23", movieId: "b", directorIds: ["Q2"] }];
  expect(selectDaily(movies, recent, "2026-10-22", "secret")).toEqual(
    selectDaily([...movies].reverse(), [], "2026-10-22", "secret"),
  );
  expect(selectDaily([], [], "2026-10-22", "secret")).toBeUndefined();
});
it("uses the least recently featured popular film when a small Daily pool is exhausted", () => {
  const movies = ["a", "b"].map((id) => ({ ...mediaMovie(), id }));
  const history = [
    { date: "2026-10-21", movieId: "a", directorIds: [] },
    { date: "2026-10-20", movieId: "b", directorIds: [] },
    { date: "2026-10-19", movieId: "a", directorIds: [] },
  ];
  expect(selectDaily(movies, history, "2026-10-22", "secret")?.id).toBe("b");
  expect(selectDaily([movies[0]], history, "2026-10-22", "secret")?.id).toBe("a");
});

it("keeps a full year of Daily choices popular and varied without repeats in the 180-day window", async () => {
  const { movies, packs } = JSON.parse(readFileSync("data/catalog.json", "utf8"));
  const catalog = new Catalog(movies, packs, await readDailyPool());
  const candidates = catalog.dailyCandidates();
  const history: { date: string; movieId: string; directorIds: string[] }[] = [];
  for (let day = 0; day < 365; day++) {
    const date = utcDate(new Date(Date.UTC(2027, 0, 1 + day)));
    const chosen = selectDaily(candidates, history, date, "year-simulation");
    expect(chosen).toBeDefined();
    if (!chosen) throw new Error("Missing Daily");
    expect(history.slice(-180).some((r) => r.movieId === chosen.id)).toBe(false);
    const directors = new Set(history.slice(-7).flatMap((r) => r.directorIds));
    expect(chosen.directors.some((d) => directors.has(d.id))).toBe(false);
    history.push({ date, movieId: chosen.id, directorIds: chosen.directors.map((d) => d.id) });
  }
});
it("applies the exact 180-day repeat boundary", () => {
  const movies = ["a", "b"].map((id) => ({ ...mediaMovie(), id }));
  const date = "2026-10-22";
  const history = [{ date: "2026-04-25", movieId: "a", directorIds: [] }];
  expect(selectDaily(movies, history, date, "secret")?.id).toBe("b");
  expect(selectDaily(movies, [{ ...history[0], date: "2026-04-24" }], date, "secret")).toEqual(
    selectDaily(movies, [], date, "secret"),
  );
});

it("combines Russia and USSR by country identity and includes co-productions without admitting unrelated films", () => {
  const rules = { countryIds: ["Q159", "Q15180", "iso:RU", "iso:SU"] };
  const pack = packSchema.parse({
    id: "country-russia-ussr",
    name: { en: "Russia & USSR" },
    description: {},
    rules,
  });
  const base = mediaMovie();
  for (const id of rules.countryIds) {
    expect(inPack({ ...base, countries: [{ id, name: "Country", names: {} }] }, pack)).toBe(true);
  }
  expect(
    inPack(
      { ...base, countries: [...base.countries, { id: "Q159", name: "Russia", names: {} }] },
      pack,
    ),
  ).toBe(true);
  expect(inPack(base, pack)).toBe(false);
  expect(inPack({ ...base, countries: [] }, pack)).toBe(false);
  expect(
    inPack(
      { ...base, releaseYear: 1980, countries: [{ id: "Q15180", name: "USSR", names: {} }] },
      { ...pack, rules: { ...rules, yearMin: 1991 } },
    ),
  ).toBe(false);
});

it("corrects saved country labels in API guesses and answers without rewriting snapshots or comparison results", async () => {
  const movie: Movie = {
    ...JSON.parse(readFileSync("data/catalog.json", "utf8")).movies[0],
    countries: [
      { id: "iso:SU", name: "Soviet Union", names: { en: "Soviet Union", ru: "Россия" } },
    ],
  };
  const comparison = compareMovies(movie, movie);
  const original = structuredClone({ movie, comparison });
  const query = vi
    .fn()
    .mockResolvedValueOnce({
      rows: [
        {
          id: "saved",
          mode: "unlimited",
          date: null,
          status: "won",
          difficulty: "normal",
          target_id: movie.id,
          target_snapshot: movie,
        },
      ],
    })
    .mockResolvedValueOnce({ rows: [{ movie_id: movie.id, comparison }] })
    .mockResolvedValueOnce({ rows: [] });
  const client = { query } as unknown as NonNullable<Parameters<Games["view"]>[2]>;
  const result = await new Games(new Catalog([movie], []), "secret").view(
    "saved",
    "visitor",
    client,
  );
  expect(result.answer?.countries[0].names.ru).toBe("СССР");
  expect(result.guesses[0].comparison.countries.values[0].names.ru).toBe("СССР");
  expect(result.guesses[0].comparison.countries.matches[0].names.ru).toBe("СССР");
  expect(result.guesses[0].comparison.countries.status).toBe(comparison.countries.status);
  expect(result.guesses[0].comparison.runtime).toEqual(comparison.runtime);
  expect({ movie, comparison }).toEqual(original);
  expect(query.mock.calls.every(([sql]) => sql.startsWith("SELECT"))).toBe(true);
});
