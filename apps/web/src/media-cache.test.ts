import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadMovieMedia } from "./media-cache.ts";

const media = {
  poster: {
    url: "https://image.tmdb.org/t/p/w185/test.jpg",
    source: "https://www.themoviedb.org/movie/1",
    author: "TMDB",
    license: "TMDB-terms",
    licenseUrl: "https://www.themoviedb.org/terms-of-use",
    provider: "tmdb",
  },
  people: {},
  countries: { Q30: "US" },
};
beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mockMedia(value: unknown = media) {
  const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(value)));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
it("shares simultaneous requests and persists results across module reloads", async () => {
  const fetch = mockMedia();
  const first = loadMovieMedia("film");
  expect(loadMovieMedia("film")).toBe(first);
  expect(await first).toEqual(media);
  vi.resetModules();
  const reloaded = await import("./media-cache.ts");
  expect(await reloaded.loadMovieMedia("film")).toEqual(media);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("refreshes images after 24 hours and empty results after 15 minutes", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000000);
  const fetch = mockMedia();
  await loadMovieMedia("film");
  clock.mockReturnValue(1000000 + 86400000 - 1);
  await loadMovieMedia("film");
  expect(fetch).toHaveBeenCalledTimes(1);
  clock.mockReturnValue(1000000 + 86400000);
  await loadMovieMedia("film");
  expect(fetch).toHaveBeenCalledTimes(2);
  const emptyFetch = mockMedia({ people: {}, countries: {} });
  await loadMovieMedia("empty");
  clock.mockReturnValue(1000000 + 86400000 + 900000 - 1);
  await loadMovieMedia("empty");
  expect(emptyFetch).toHaveBeenCalledTimes(1);
  clock.mockReturnValue(1000000 + 86400000 + 900000);
  await loadMovieMedia("empty");
  expect(emptyFetch).toHaveBeenCalledTimes(2);
});
it("does not cache failed or malformed responses and recovers from corrupt storage", async () => {
  localStorage.setItem("cineclue:media:v2", "broken json");
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(new Response("{}"))
    .mockResolvedValueOnce(new Response("{}", { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(media)));
  vi.stubGlobal("fetch", fetch);
  await expect(loadMovieMedia("film")).rejects.toThrow("offline");
  await expect(loadMovieMedia("film")).rejects.toThrow();
  await expect(loadMovieMedia("film")).rejects.toThrow("503");
  expect(await loadMovieMedia("film")).toEqual(media);
  expect(fetch).toHaveBeenCalledTimes(4);
});
it("keeps media available when browser storage is blocked", async () => {
  mockMedia();
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("full");
  });
  expect(await loadMovieMedia("film")).toEqual(media);
});
it("bounds persisted entries to 100 films", async () => {
  vi.spyOn(Date, "now").mockReturnValue(1000000);
  mockMedia();
  for (let i = 0; i < 105; i++) await loadMovieMedia(`film${i}`);
  const stored = JSON.parse(localStorage.getItem("cineclue:media:v2") ?? "{}");
  expect(Object.keys(stored)).toHaveLength(100);
  expect(stored.film104.media).toEqual(media);
});
