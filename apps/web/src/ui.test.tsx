import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  compareMovies,
  type GameView,
  type Movie,
  publicMovie,
} from "../../../packages/game-engine/src/index.ts";
import App from "./App.tsx";
import { Clues } from "./Clues.tsx";
import { dictionaries } from "./i18n.ts";
import { Search } from "./Search.tsx";

const movie = {
  id: "m1",
  title: "Interstellar",
  originalTitle: "Interstellar",
  titles: { en: "Interstellar", ru: "Интерстеллар" },
  releaseYear: 2014,
  runtime: 169,
  directors: [{ id: "n", name: "Christopher Nolan", names: {} }],
  actors: [],
  genres: [],
  studios: [],
  countries: [],
  aliases: [],
  externalIds: {},
  provenance: [],
  popularityScore: 90,
} satisfies Movie;
const playing: GameView = {
  id: "g1",
  mode: "daily",
  date: "2099-10-21",
  status: "playing",
  guesses: [],
  maxAttempts: 8,
  difficulty: "normal",
  hints: {
    unlocked: 0,
    remaining: 0,
    nextUnlock: 3,
    options: ["genres", "actor", "decade"],
    used: [],
  },
  nextPuzzleAt: "2099-10-22T00:00:00Z",
};
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("cineclue:locale", '"en"');
  window.history.replaceState({}, "", "/");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("supports autocomplete by keyboard and handles no results", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ movies: [publicMovie(movie)] })));
  vi.stubGlobal("fetch", fetch);
  const select = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<Search locale="en" t={dictionaries.en} onSelect={select} />);
  await user.type(screen.getByRole("combobox"), "inter");
  await screen.findByRole("option");
  await user.keyboard("{ArrowDown}{Enter}");
  expect(select).toHaveBeenCalledWith(publicMovie(movie));
  fetch.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ movies: [] }))));
  await user.type(screen.getByRole("combobox"), "zzzz");
  await screen.findByText(dictionaries.en.noResults);
});
it("renders empty state and accessible result directions and exact matches", () => {
  const { rerender } = render(<Clues game={playing} locale="en" t={dictionaries.en} />);
  expect(screen.getByText(dictionaries.en.emptyTitle)).toBeTruthy();
  const comparison = compareMovies(movie, { ...movie, releaseYear: 2017 });
  rerender(
    <Clues
      game={{ ...playing, guesses: [{ movie: publicMovie(movie), comparison }] }}
      locale="ru"
      t={dictionaries.ru}
    />,
  );
  expect(screen.getByText("Интерстеллар")).toBeTruthy();
  expect(screen.getByLabelText(dictionaries.ru.higher)).toBeTruthy();
  expect(screen.getAllByText(dictionaries.ru.exact).length).toBeGreaterThan(0);
});
it.each(["won", "lost"] as const)("shows %s and the answer after completion", async (status) => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url.endsWith("/packs")
              ? { packs: [], catalogSize: 1 }
              : {
                  ...playing,
                  status,
                  guesses: [{ movie: publicMovie(movie), comparison: compareMovies(movie, movie) }],
                  answer: movie,
                },
          ),
        ),
      ),
    ),
  );
  render(<App />);
  await screen.findByText(dictionaries.en[status]);
  expect(document.querySelector(".confetti")).toBeNull();
  expect(screen.getAllByText("Interstellar").length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: /Share result/ })).toBeTruthy();
  expect(screen.queryByRole("combobox", { name: dictionaries.en.search })).toBeNull();
  await waitFor(() =>
    expect(JSON.parse(localStorage.getItem("cineclue:records") ?? "[]")).toHaveLength(1),
  );
});
it("shows a recoverable API error and loading state", async () => {
  let reject: (e: Error) => void = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) =>
      url.endsWith("/packs")
        ? Promise.resolve(new Response(JSON.stringify({ packs: [], catalogSize: 0 })))
        : new Promise((_, r) => {
            reject = r;
          }),
    ),
  );
  render(<App />);
  expect(screen.getByText(dictionaries.en.loading)).toBeTruthy();
  reject(new Error("offline"));
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(screen.getByText(dictionaries.en.loading)).toBeTruthy();
});

it("groups film collections and shows counts for the selected difficulty", async () => {
  const packs = [
    {
      id: "popular",
      name: { en: "All movies" },
      count: 30,
      counts: { easy: 20, normal: 25, hard: 30 },
      category: "all",
    },
    {
      id: "animation",
      name: { en: "Animation" },
      count: 12,
      counts: { easy: 5, normal: 8, hard: 12 },
      category: "genre",
    },
    {
      id: "nineties",
      name: { en: "The 1990s" },
      count: 15,
      counts: { easy: 10, normal: 13, hard: 15 },
      category: "era",
    },
    {
      id: "nolan",
      name: { en: "Nolan" },
      count: 10,
      counts: { easy: 10, normal: 10, hard: 10 },
      category: "director",
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              url.endsWith("/packs")
                ? { packs, catalogSize: 30 }
                : { ...playing, mode: url.includes("unlimited") ? "unlimited" : "daily" },
            ),
          ),
        ),
      ),
  );
  render(<App />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Unlimited" }).hasAttribute("disabled")).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Unlimited" }));
  await screen.findByRole("combobox", { name: "Film collection" });
  expect(screen.getByRole("option", { name: "Animation (8)" })).toBeTruthy();
  expect(screen.getByRole("group", { name: "Genres & themes" })).toBeTruthy();
  expect(screen.getByRole("group", { name: "Decades & eras" })).toBeTruthy();
  expect(screen.getByRole("group", { name: "Directors" })).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "Difficulty" }), {
    target: { value: "easy" },
  });
  expect(screen.getByRole("option", { name: "Animation (5)" })).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "Difficulty" }), {
    target: { value: "hard" },
  });
  expect(screen.getByRole("option", { name: "Animation (12)" })).toBeTruthy();
});

it("celebrates a new winning guess but does not replay confetti on reload", async () => {
  const won = {
    ...playing,
    status: "won",
    answer: movie,
    guesses: [{ movie: publicMovie(movie), comparison: compareMovies(movie, movie) }],
  };
  let finished = false;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url.includes("/guess")) finished = true;
      const body = url.endsWith("/packs")
        ? { packs: [], catalogSize: 1 }
        : url.includes("/search")
          ? { movies: [publicMovie(movie)] }
          : url.includes("/media/")
            ? { people: {}, countries: {} }
            : finished
              ? won
              : playing;
      return Promise.resolve(new Response(JSON.stringify(body)));
    }),
  );
  const { unmount } = render(<App />);
  const user = userEvent.setup();
  await user.type(await screen.findByRole("combobox", { name: dictionaries.en.search }), "inter");
  await screen.findByRole("option", { name: /Interstellar/ });
  await user.keyboard("{ArrowDown}{Enter}");
  await screen.findByText(dictionaries.en.won);
  expect(document.querySelector(".confetti")).toBeTruthy();
  unmount();
  render(<App />);
  await screen.findByText(dictionaries.en.won);
  expect(document.querySelector(".confetti")).toBeNull();
});

it("attributes a mixed TMDB catalog independently of image loading", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              url.endsWith("/packs")
                ? { packs: [], catalogSize: 10000, dataSources: ["wikidata", "tmdb"] }
                : playing,
            ),
          ),
        ),
      ),
  );
  const { container } = render(<App />);
  await screen.findByText(dictionaries.en.mixedData, { exact: false });
  expect(container.querySelector("footer .catalog-credit img")?.getAttribute("alt")).toBe("TMDB");
  expect(screen.getByText(/not endorsed or certified by TMDB/)).toBeTruthy();
});

it.each(["success", "blocked", "cancelled", "missing", "both-fail"])(
  "handles result sharing: %s",
  async (mode) => {
    const share =
      mode === "missing"
        ? undefined
        : vi
            .fn()
            .mockImplementation(() =>
              mode === "success"
                ? Promise.resolve()
                : Promise.reject(
                    new DOMException(
                      "Unavailable",
                      mode === "cancelled" ? "AbortError" : "NotAllowedError",
                    ),
                  ),
            );
    const copy = vi
      .fn()
      .mockImplementation(() =>
        mode === "both-fail" ? Promise.reject(new Error("Denied")) : Promise.resolve(),
      );
    vi.stubGlobal("navigator", { language: "en", share, clipboard: { writeText: copy } });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              url.endsWith("/packs")
                ? { packs: [], catalogSize: 1 }
                : url.includes("/media/")
                  ? { people: {}, countries: {} }
                  : {
                      ...playing,
                      status: "won",
                      answer: movie,
                      guesses: [
                        { movie: publicMovie(movie), comparison: compareMovies(movie, movie) },
                      ],
                    },
            ),
          ),
        ),
      ),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Share result/ }));
    await waitFor(() => {
      if (mode === "blocked" || mode === "missing" || mode === "both-fail")
        expect(copy).toHaveBeenCalledTimes(1);
      else expect(copy).not.toHaveBeenCalled();
      if (mode === "both-fail") expect(document.querySelector(".share-fallback")).toBeTruthy();
      else expect(document.querySelector(".share-fallback")).toBeNull();
    });
  },
);
it("preserves a Daily record saved by another tab after mount", async () => {
  let finish: (r: Response) => void = () => {};
  const deferred = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation((url: string) =>
        url.endsWith("/daily")
          ? deferred
          : Promise.resolve(
              new Response(
                JSON.stringify(
                  url.endsWith("/packs")
                    ? { packs: [], catalogSize: 1 }
                    : { people: {}, countries: {} },
                ),
              ),
            ),
      ),
  );
  render(<App />);
  localStorage.setItem(
    "cineclue:records",
    JSON.stringify([{ date: "2099-10-20", won: true, attempts: 2 }]),
  );
  finish(
    new Response(
      JSON.stringify({
        ...playing,
        status: "won",
        answer: movie,
        guesses: [{ movie: publicMovie(movie), comparison: compareMovies(movie, movie) }],
      }),
    ),
  );
  await waitFor(() =>
    expect(
      JSON.parse(localStorage.getItem("cineclue:records") ?? "[]").map(
        (r: { date: string }) => r.date,
      ),
    ).toEqual(["2099-10-20", "2099-10-21"]),
  );
});
