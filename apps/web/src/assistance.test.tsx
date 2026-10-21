import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  compareMovies,
  type GameView,
  type Movie,
  publicMovie,
} from "../../../packages/game-engine/src/index.ts";
import { Clues } from "./Clues.tsx";
import { Hints } from "./Hints.tsx";
import { dictionaries } from "./i18n.ts";
import { shareText } from "./results.ts";
import { TIP_INTERVAL_MS, Tips } from "./Tips.tsx";

const movie = {
  id: "old",
  title: "Older guess",
  originalTitle: "Older guess",
  titles: {},
  releaseYear: 2001,
  runtime: 100,
  directors: [],
  actors: [],
  genres: [],
  studios: [],
  countries: [],
  aliases: [],
  externalIds: {},
  provenance: [],
  popularityScore: 50,
} satisfies Movie;
const game: GameView = {
  id: "hint-session",
  mode: "unlimited",
  date: null,
  status: "playing",
  guesses: [{ movie: publicMovie(movie), comparison: compareMovies(movie, movie) }],
  maxAttempts: 8,
  difficulty: "normal",
  hints: {
    unlocked: 1,
    remaining: 1,
    nextUnlock: 7,
    options: ["actor", "genres", "decade"],
    used: [],
  },
};
const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
beforeEach(() => {
  localStorage.clear();
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.removeAttribute("open");
        this.dispatchEvent(new Event("close"));
      },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});
it("puts new guesses first without changing their original numbers or share chronology", () => {
  const newer = { ...movie, id: "new", title: "Newest guess", releaseYear: 2004 };
  const value = {
    ...game,
    guesses: [
      ...game.guesses,
      { movie: publicMovie(newer), comparison: compareMovies(newer, movie) },
    ],
  };
  render(<Clues game={value} locale="en" t={dictionaries.en} />);
  const articles = screen.getAllByRole("article");
  expect(within(articles[0]).getByText("Newest guess")).toBeTruthy();
  expect(within(articles[0]).getByText("02")).toBeTruthy();
  expect(within(articles[1]).getByText("01")).toBeTruthy();
  expect(value.guesses[0].movie.id).toBe("old");
  expect(shareText(value).split("\n")[2]).not.toEqual(shareText(value).split("\n")[3]);
});
it("rotates tips, supports manual navigation and pause, and stops on focus", () => {
  vi.useFakeTimers();
  render(<Tips t={dictionaries.en} />);
  expect(screen.getByText(dictionaries.en.tipArrowsTitle)).toBeTruthy();
  act(() => vi.advanceTimersByTime(TIP_INTERVAL_MS));
  expect(screen.getByText(dictionaries.en.tipMatchesTitle)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: dictionaries.en.pauseTips }));
  act(() => vi.advanceTimersByTime(TIP_INTERVAL_MS * 2));
  expect(screen.getByText(dictionaries.en.tipMatchesTitle)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: dictionaries.en.nextTip }));
  expect(screen.getByText(dictionaries.en.tipCloseTitle)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: dictionaries.en.playTips }));
  fireEvent.focus(screen.getByRole("button", { name: dictionaries.en.nextTip }));
  act(() => vi.advanceTimersByTime(TIP_INTERVAL_MS));
  expect(screen.getByText(dictionaries.en.tipCloseTitle)).toBeTruthy();
});
it("keeps tip progress in sync with hover pause, resume and manual navigation", () => {
  vi.useFakeTimers();
  render(<Tips t={dictionaries.en} />);
  const region = screen.getByRole("region", { name: "Tip" });
  const progress = () =>
    region.querySelector<HTMLElement>(".tip-progress .active > span")?.style.transform;
  act(() => vi.advanceTimersByTime(TIP_INTERVAL_MS / 2));
  expect(progress()).toBe("scaleX(0.5)");
  fireEvent.mouseEnter(region);
  act(() => vi.advanceTimersByTime(TIP_INTERVAL_MS));
  expect(progress()).toBe("scaleX(0.5)");
  expect(screen.getByText(dictionaries.en.tipArrowsTitle)).toBeTruthy();
  fireEvent.mouseLeave(region);
  act(() => vi.advanceTimersByTime(TIP_INTERVAL_MS / 2));
  expect(screen.getByText(dictionaries.en.tipMatchesTitle)).toBeTruthy();
  expect(progress()).toBe("scaleX(0)");
  act(() => vi.advanceTimersByTime(TIP_INTERVAL_MS / 2));
  fireEvent.click(screen.getByRole("button", { name: dictionaries.en.nextTip }));
  expect(progress()).toBe("scaleX(0)");
  act(() => vi.advanceTimersByTime(TIP_INTERVAL_MS - 50));
  expect(screen.getByText(dictionaries.en.tipCloseTitle)).toBeTruthy();
  act(() => vi.advanceTimersByTime(50));
  expect(screen.getByText(dictionaries.en.tipSearchTitle)).toBeTruthy();
});
it("keeps reduced-motion tips paused until explicitly resumed", () => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  render(<Tips t={dictionaries.en} />);
  act(() => vi.advanceTimersByTime(TIP_INTERVAL_MS * 2));
  expect(screen.getByText(dictionaries.en.tipArrowsTitle)).toBeTruthy();
  expect(screen.getByRole("button", { name: dictionaries.en.playTips })).toBeTruthy();
  vi.unstubAllGlobals();
});
it("offers a newly unlocked hint, submits the selected category, and remembers dismissed offers", async () => {
  const use = vi.fn().mockResolvedValue(undefined);
  const props = { game, locale: "en" as const, t: dictionaries.en, pending: false, onUse: use };
  const { unmount } = render(<Hints {...props} />);
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText(dictionaries.en.chooseHint)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: /Cast member/ }));
  await act(async () => {});
  expect(use).toHaveBeenCalledWith("actor");
  expect(screen.queryByRole("dialog")).toBeNull();
  unmount();
  render(<Hints {...props} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Hints/ }));
  expect(screen.getByRole("dialog")).toBeTruthy();
});
it("locks hints before three misses and shows saved clues without reopening after reload", () => {
  const use = vi.fn();
  const { rerender } = render(
    <Hints
      game={{ ...game, hints: { ...game.hints, unlocked: 0, remaining: 0 } }}
      locale="ru"
      t={dictionaries.ru}
      pending={false}
      onUse={use}
    />,
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: /Подсказки/ }).hasAttribute("disabled")).toBe(true);
  rerender(
    <Hints
      game={{
        ...game,
        hints: { ...game.hints, remaining: 0, used: [{ kind: "decade", decade: 1990 }] },
      }}
      locale="ru"
      t={dictionaries.ru}
      pending={false}
      onUse={use}
    />,
  );
  expect(screen.getByText("1990–е")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("offers the second hint after seven misses and marks a used category as disabled", () => {
  localStorage.setItem(`cineclue:hint-offer:${game.id}`, "1");
  render(
    <Hints
      game={{
        ...game,
        hints: {
          ...game.hints,
          unlocked: 2,
          remaining: 1,
          nextUnlock: null,
          used: [{ kind: "decade", decade: 1990 }],
        },
      }}
      locale="en"
      t={dictionaries.en}
      pending={false}
      onUse={vi.fn()}
    />,
  );
  const dialog = screen.getByRole("dialog");
  expect(
    within(dialog)
      .getByRole("button", { name: /Release decade/ })
      .hasAttribute("disabled"),
  ).toBe(true);
});

it("explicit Play resumes tips while the control retains focus and pointer", () => {
  vi.useFakeTimers();
  render(<Tips t={dictionaries.en} />);
  const region = screen.getByRole("region", { name: "Tip" });
  fireEvent.mouseEnter(region);
  const button = screen.getByRole("button", { name: dictionaries.en.pauseTips });
  act(() => button.focus());
  fireEvent.click(button);
  fireEvent.click(screen.getByRole("button", { name: dictionaries.en.playTips }));
  expect(document.activeElement).toBe(button);
  act(() => vi.advanceTimersByTime(TIP_INTERVAL_MS));
  expect(screen.getByText(dictionaries.en.tipMatchesTitle)).toBeTruthy();
  fireEvent.blur(button);
  fireEvent.focus(screen.getByRole("button", { name: dictionaries.en.nextTip }));
  act(() => vi.advanceTimersByTime(TIP_INTERVAL_MS));
  expect(screen.getByText(dictionaries.en.tipMatchesTitle)).toBeTruthy();
});
