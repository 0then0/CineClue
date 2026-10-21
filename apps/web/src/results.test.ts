import { expect, it } from "vitest";
import {
  compareMovies,
  type GameView,
  type Movie,
} from "../../../packages/game-engine/src/index.ts";
import { shareText, stats } from "./results.ts";

const movie = {
  id: "secret",
  title: "Secret film",
  releaseYear: 1994,
  runtime: 142,
  directors: [],
  actors: [],
  genres: [],
  studios: [],
  countries: [],
} as unknown as Movie;
it("shares seven clue cells without any answer, movie IDs, or titles", () => {
  const game = {
    mode: "daily",
    date: "2026-10-21",
    guesses: [{ movie, comparison: compareMovies(movie, movie) }],
    status: "won",
    maxAttempts: 8,
    answer: movie,
  } as unknown as GameView;
  const text = shareText(game);
  expect(text).toContain("1/8");
  expect(text).toContain("🟩");
  expect(text).not.toMatch(/secret|Secret|1994|142/);
  expect(text.split("\n")[2]).toHaveLength(14);
});
it("counts wins, gaps, defeats, duplicate dates and yesterday streaks correctly", () => {
  const records = [
    { date: "2026-10-18", won: true, attempts: 2 },
    { date: "2026-10-19", won: true, attempts: 3 },
    { date: "2026-10-20", won: false, attempts: 8 },
    { date: "2026-10-21", won: true, attempts: 1 },
  ];
  expect(stats(records, "2026-10-21")).toMatchObject({
    played: 4,
    wins: 3,
    winRate: 75,
    streak: 1,
    best: 2,
    distribution: [1, 1, 1, 0, 0, 0, 0, 0],
  });
  expect(stats(records.slice(0, 2), "2026-10-20").streak).toBe(2);
  expect(stats(records.slice(0, 2), "2026-10-21").streak).toBe(0);
  expect(stats([...records, records[3]], "2026-10-21").played).toBe(4);
});
