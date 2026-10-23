import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FilmShelf, selectShelf } from "./FilmShelf.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("keeps three distinct posters across reloads until the daily cache expires", () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
  const random = vi.spyOn(Math, "random").mockReturnValue(0);
  const first = selectShelf();
  expect(new Set(first.map((p) => p.id)).size).toBe(3);
  random.mockReturnValue(0.9);
  expect(selectShelf()).toEqual(first);
  clock.mockReturnValue(86401000);
  expect(selectShelf()).not.toEqual(first);
});
it("recovers from corrupted storage without using cached URLs", () => {
  localStorage.setItem(
    "cineclue:poster-shelf:v1",
    JSON.stringify({ expires: Date.now() + 5000, ids: ["bad", "bad", "bad"] }),
  );
  const selected = selectShelf();
  expect(selected).toHaveLength(3);
  expect(selected.every((p) => p.source.startsWith("https://www.themoviedb.org/movie/"))).toBe(
    true,
  );
});
it("links every poster to its movie and localizes accessible titles", () => {
  const selected = selectShelf();
  render(<FilmShelf locale="ru" label="TMDB" />);
  for (const poster of selected) {
    const link = screen.getByRole("link", { name: poster.ru });
    expect(link.getAttribute("href")).toBe(poster.source);
    expect(link.getAttribute("rel")).toBe("noreferrer");
  }
});
it("still selects posters when browser storage is blocked", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(selectShelf()).toHaveLength(3);
});
it("keeps the selection when changing locale without requesting the API", () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  try {
    const selected = selectShelf();
    const { rerender } = render(<FilmShelf locale="en" label="TMDB" />);
    for (const poster of selected) {
      expect(screen.getByRole("link", { name: poster.title }).getAttribute("href")).toBe(
        poster.source,
      );
    }
    rerender(<FilmShelf locale="ru" label="TMDB" />);
    for (const poster of selected) {
      expect(screen.getByRole("link", { name: poster.ru }).getAttribute("href")).toBe(
        poster.source,
      );
    }
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
