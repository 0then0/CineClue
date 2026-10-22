import { readFileSync } from "node:fs";
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
  studios: [{ id: "studio", name: "Example Studio", names: {} }],
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
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          poster: image,
          people: { d: image },
          countries: { Q30: "US" },
          studios: { studio: image },
        }),
      ),
    ),
  );
  const { container } = render(<Clues game={game} locale="en" t={dictionaries.en} />);
  await screen.findByText("🇺🇸");
  expect(container.querySelectorAll(".movie-poster img, .person-photo img")).toHaveLength(2);
  expect(container.querySelectorAll(".studio-logo img")).toHaveLength(1);
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
          studios: { studio: image },
          countries: { Q30: "US" },
        }),
      ),
    ),
  );
  const { container, unmount } = render(<Answer movie={movie} locale="en" t={dictionaries.en} />);
  await screen.findByText("🇺🇸");
  expect(container.querySelectorAll(".movie-poster img")).toHaveLength(1);
  expect(container.querySelectorAll(".person-photo img")).toHaveLength(2);
  expect(container.querySelectorAll(".studio-logo img")).toHaveLength(1);
  const logo = container.querySelector(".studio-logo img");
  if (!logo) throw Error("Expected studio logo");
  fireEvent.error(logo);
  expect(container.querySelector(".studio-logo")).toBeNull();
  expect(screen.getByText("Example Studio")).toBeTruthy();
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

it.each([
  ["genres", "Genres"],
  ["studios", "Studio"],
  ["countries", "Country"],
] as const)("expands only remaining %s without repeating visible matches", (kind, heading) => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ people: {}, countries: {} }))),
  );
  const genres = ["Drama", "Comedy", "Adventure", "Mystery"].map((name, i) => ({
    id: `genre${i}`,
    name,
    names: {},
  }));
  const guessed = { ...movie, [kind]: genres };
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
        comparison: compareMovies(guessed, { ...guessed, [kind]: [genres[3]] }),
      },
    ],
    hints: { unlocked: 0, remaining: 0, nextUnlock: 3, options: [], used: [] },
  } satisfies GameView;
  render(<Clues game={game} locale="en" t={dictionaries.en} />);
  const section = screen.getByRole("heading", { name: heading }).parentElement as HTMLElement;
  const visible = section.querySelector(".entity-list") as HTMLElement;
  expect(Array.from(visible.querySelectorAll(".entity-name"), (e) => e.textContent)).toEqual([
    "Mystery",
    "Drama",
  ]);
  const toggle = within(section).getByLabelText(`Show all: ${heading}`);
  expect(toggle.textContent).toBe("+2");
  fireEvent.click(toggle);
  expect(section.querySelector("details")?.open).toBe(true);
  expect(
    Array.from(section.querySelectorAll(".expanded-entities .entity-name"), (e) => e.textContent),
  ).toEqual(["Comedy", "Adventure"]);
  for (const genre of genres) expect(within(section).getAllByText(genre.name)).toHaveLength(1);
  fireEvent.click(toggle);
  expect(section.querySelector("details")?.open).toBe(false);
});

it.each(["genres", "studios", "countries"] as const)(
  "does not offer an empty expansion for a long %s name",
  (kind) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ people: {}, countries: {} }))),
    );
    const name = "Compass International Pictures";
    const guessed = { ...movie, [kind]: [{ id: "long", name, names: {} }] };
    const game: GameView = {
      id: "long-name",
      mode: "unlimited",
      date: null,
      status: "playing",
      maxAttempts: 8,
      difficulty: "normal",
      guesses: [{ movie: publicMovie(guessed), comparison: compareMovies(guessed, guessed) }],
      hints: { unlocked: 0, remaining: 0, nextUnlock: 3, options: [], used: [] },
    };
    const { container } = render(<Clues game={game} locale="en" t={dictionaries.en} />);
    const clue = container.querySelector(`[data-kind="${kind}"]`) as HTMLElement;
    expect(within(clue).getAllByText(name)).toHaveLength(1);
    expect(clue.querySelector("details")).toBeNull();
  },
);

it("places answer studios across both mobile columns like the other film metadata", () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  const style = document.createElement("style");
  style.textContent = readFileSync("apps/web/src/style.css", "utf8");
  document.head.append(style);
  const mobile = document.createElement("style");
  try {
    // jsdom has CSSOM but no viewport layout: apply the actual 600px rules explicitly.
    mobile.textContent = Array.from(style.sheet?.cssRules ?? [])
      .filter((rule) => rule.type === 4)
      .map((rule) => rule as CSSMediaRule)
      .filter((rule) => rule.conditionText === "(max-width: 600px)")
      .flatMap((rule) => Array.from(rule.cssRules, (child) => child.cssText))
      .join("\n");
    document.head.append(mobile);
    const { container } = render(<Answer movie={movie} locale="en" t={dictionaries.en} />);
    const studios = container.querySelector(".answer-studios");
    const countries = container.querySelector(".answer-countries");
    if (!studios || !countries) throw Error("Expected film metadata");
    expect(getComputedStyle(studios).gridColumn).toBe("1 / -1");
    expect(getComputedStyle(studios).gridColumn).toBe(getComputedStyle(countries).gridColumn);
    expect(studios.textContent).toContain("Example Studio");
  } finally {
    mobile.remove();
    style.remove();
  }
});
