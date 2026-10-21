import { expect, it, vi } from "vitest";
import type { Movie } from "../../../packages/game-engine/src/model.ts";
import { Catalog } from "../src/catalog.ts";
import { dailyIndex, nextMidnight, utcDate } from "../src/game.ts";

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
