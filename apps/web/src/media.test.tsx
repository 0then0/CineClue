import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  compareMovies,
  type GameView,
  type Movie,
  publicMovie,
} from "../../../packages/game-engine/src/index.ts";
import { Answer } from "./Answer.tsx";
import { Clues } from "./Clues.tsx";
import { dictionaries } from "./i18n.ts";
import { flag } from "./Media.tsx";

const movie = {
  id: "m",
  title: "Film",
  originalTitle: "Film",
  titles: {},
  aliases: [],
  releaseYear: 2000,
  runtime: 100,
  actors: Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `Actor ${i}`, names: {} })),
  directors: [{ id: "d", name: "Director Person", names: {} }],
  countries: [{ id: "Q30", name: "United States", names: {} }],
  genres: [],
  studios: [],
  externalIds: {},
  popularityScore: 50,
  provenance: [],
} satisfies Movie;

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("uses ISO flags without inventing modern flags for historical or unknown countries", () => {
  expect(flag("US")).toBe("🇺🇸");
  expect(flag("GB")).toBe("🇬🇧");
  expect(flag("SU")).toBe("🌐");
  expect(flag("unknown")).toBe("🌐");
});
it("shows attributed images, prioritizes matches and keeps the full cast visible", async () => {
  const comparison = compareMovies(movie, { ...movie, actors: [movie.actors[4]] });
  const game: GameView = {
    id: "g",
    mode: "unlimited",
    date: null,
    status: "playing",
    maxAttempts: 8,
    difficulty: "normal",
    guesses: [{ movie: publicMovie(movie), comparison }],
    hints: { unlocked: 0, remaining: 0, nextUnlock: 3, options: [], used: [] },
  };
  const image = {
    url: "https://upload.wikimedia.org/test.jpg",
    source: "https://commons.wikimedia.org/wiki/File:Test.jpg",
    author: "Photographer",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
    provider: "commons",
  };
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ poster: image, people: { d: image }, countries: { Q30: "US" } }),
        ),
      ),
  );
  const { container } = render(<Clues game={game} locale="en" t={dictionaries.en} />);
  await screen.findByText("🇺🇸");
  expect(container.querySelectorAll(".movie-poster img, .person-photo img")).toHaveLength(2);
  const actors = screen.getByRole("heading", { name: "Cast" }).parentElement;
  expect(actors).toBeTruthy();
  const preview = actors?.querySelector(".people-list");
  expect(preview?.textContent).toContain("Actor 4");
  expect(preview?.textContent).toContain("Actor 3");
  expect(screen.queryByLabelText("Show all: Cast")).toBeNull();
  expect(screen.getByRole("img", { name: "Actor 4: Exact match" })).toBeTruthy();
  expect(screen.getByRole("img", { name: "Actor 3: No match" })).toBeTruthy();
  expect(within(actors as HTMLElement).getByText("Some in common")).toBeTruthy();
  expect(within(actors as HTMLElement).getAllByText("Actor 3")).toHaveLength(1);
  const photo = container.querySelector(".person-photo img");
  if (!photo) throw Error("Expected director image");
  fireEvent.error(photo);
  expect(container.querySelector(".person-photo img")).toBeNull();
  expect(screen.getByText("Director Person")).toBeTruthy();
  fireEvent.click(screen.getByText("Images & licenses"));
  expect(screen.getByRole("link", { name: "Photographer" }).getAttribute("href")).toBe(
    image.source,
  );
});

it("shows answer images, country flags and credits while preserving text when media is unavailable", async () => {
  const image = {
    url: "https://image.tmdb.org/t/p/w185/test.jpg",
    source: "https://www.themoviedb.org/movie/1",
    author: "TMDB",
    license: "TMDB-terms",
    licenseUrl: "https://www.themoviedb.org/terms-of-use",
    provider: "tmdb",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          poster: image,
          people: { d: image, p0: image },
          countries: { Q30: "US" },
        }),
      ),
    ),
  );
  const { container, unmount } = render(<Answer movie={movie} locale="en" t={dictionaries.en} />);
  await screen.findByText("🇺🇸");
  expect(container.querySelectorAll(".movie-poster img")).toHaveLength(1);
  expect(container.querySelectorAll(".person-photo img")).toHaveLength(2);
  expect(screen.getByText("Director Person")).toBeTruthy();
  expect(screen.getByText("Actor 4")).toBeTruthy();
  fireEvent.click(screen.getByText("Images & licenses"));
  expect(screen.getByText(/not endorsed or certified by TMDB/)).toBeTruthy();
  unmount();
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  const fallback = render(<Answer movie={movie} locale="en" t={dictionaries.en} />);
  expect(screen.getByText("Director Person")).toBeTruthy();
  expect(screen.getByText("Actor 4")).toBeTruthy();
  expect(fallback.container.querySelectorAll(".media-picture img")).toHaveLength(0);
});

it("expands only remaining genres without repeating the visible matching genres", () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ people: {}, countries: {} }))),
  );
  const genres = ["Drama", "Comedy", "Adventure", "Mystery"].map((name, i) => ({
    id: `genre${i}`,
    name,
    names: {},
  }));
  const guessed = { ...movie, genres };
  const game = {
    id: "genre-game",
    mode: "unlimited",
    date: null,
    status: "playing",
    maxAttempts: 8,
    difficulty: "normal",
    guesses: [
      {
        movie: publicMovie(guessed),
        comparison: compareMovies(guessed, { ...guessed, genres: [genres[3]] }),
      },
    ],
    hints: { unlocked: 0, remaining: 0, nextUnlock: 3, options: [], used: [] },
  } satisfies GameView;
  render(<Clues game={game} locale="en" t={dictionaries.en} />);
  const section = screen.getByRole("heading", { name: "Genres" }).parentElement as HTMLElement;
  const visible = section.querySelector(".entity-list") as HTMLElement;
  expect(visible.textContent).toBe("MysteryDrama");
  const toggle = within(section).getByLabelText("Show all: Genres");
  expect(toggle.textContent).toBe("+2");
  fireEvent.click(toggle);
  expect(section.querySelector("details")?.open).toBe(true);
  expect(section.querySelector(".expanded-entities")?.textContent).toBe("ComedyAdventure");
  for (const genre of genres) expect(within(section).getAllByText(genre.name)).toHaveLength(1);
  fireEvent.click(toggle);
  expect(section.querySelector("details")?.open).toBe(false);
});
