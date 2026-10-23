import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GameView } from "../../../packages/game-engine/src/model.ts";
import App from "./App.tsx";
import { countryName, entityName, packName } from "./catalog-i18n.ts";
import { detectLocale, dictionaries, isLocale, languages, titleOf } from "./i18n.ts";
import { shareText } from "./results.ts";

const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const game: GameView = {
  id: "locale-game",
  mode: "daily",
  date: "2099-10-21",
  status: "playing",
  guesses: [],
  maxAttempts: 8,
  difficulty: "normal",
  hints: { unlocked: 0, remaining: 0, nextUnlock: 3, options: [], used: [] },
};
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(
        async (url: string) =>
          new Response(
            JSON.stringify(url.endsWith("/packs") ? { packs: [], catalogSize: 10000 } : game),
          ),
      ),
  );
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
});
it.each(languages)("has a complete dictionary for $code", ({ code }) => {
  const messages = dictionaries[code];
  expect(Object.keys(messages).sort()).toEqual(Object.keys(dictionaries.en).sort());
  expect(Object.values(messages).every((value) => value.trim().length > 0)).toBe(true);
});
it.each([
  [["es-MX"], "es"],
  [["de-AT"], "de"],
  [["fr-CA"], "fr"],
  [["ja-JP"], "ja"],
  [["ru-RU"], "ru"],
  [["pt-BR"], "pt-BR"],
  [["pt-PT"], "pt-BR"],
  [["it-IT", "fr-FR"], "fr"],
  [["unknown"], "en"],
] as const)("detects browser preferences %j as %s", (preferences, locale) => {
  expect(detectLocale(preferences)).toBe(locale);
});
it("does not accept unsupported saved locale values", () => {
  expect(isLocale("toString")).toBe(false);
  expect(isLocale("pt-BR")).toBe(true);
});
it.each(languages)(
  "renders $name, persists it and opens translated help and statistics",
  async ({ code }) => {
    const t = dictionaries[code];
    localStorage.setItem("cineclue:locale", JSON.stringify(code));
    const { unmount } = render(<App />);
    await screen.findByRole("heading", { name: t.emptyTitle });
    expect(document.documentElement.lang).toBe(code);
    const selector = screen.getByRole("combobox", { name: t.language }) as HTMLSelectElement;
    expect(selector.value).toBe(code);
    expect(selector.options).toHaveLength(7);
    for (const language of languages) {
      const option = [...selector.options].find((option) => option.value === language.code);
      expect(option?.textContent?.trim()).toBe(`${language.flag} ${language.short}`);
      expect(option?.getAttribute("aria-label")).toBe(language.name);
    }
    expect(screen.getByRole("navigation", { name: t.gameMode })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t.help }));
    expect(screen.getByRole("heading", { name: t.help })).toBeTruthy();
    expect(screen.getByText(t.helpSets)).toBeTruthy();
    fireEvent(screen.getByRole("dialog"), new Event("close"));
    fireEvent.click(screen.getByRole("button", { name: t.stats }));
    expect(screen.getByRole("heading", { name: t.distribution })).toBeTruthy();
    fireEvent(screen.getByRole("dialog"), new Event("close"));
    const next = code === "ja" ? "es" : "ja";
    fireEvent.change(selector, { target: { value: next } });
    await waitFor(() => expect(localStorage.getItem("cineclue:locale")).toBe(JSON.stringify(next)));
    unmount();
    render(<App />);
    expect(document.documentElement.lang).toBe(next);
    expect(
      (screen.getByRole("combobox", { name: dictionaries[next].language }) as HTMLSelectElement)
        .value,
    ).toBe(next);
  },
);
it("uses browser language when stored preferences are invalid", () => {
  localStorage.setItem("cineclue:locale", '"unsupported"');
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["pt-PT", "en"]);
  render(<App />);
  expect(document.documentElement.lang).toBe("pt-BR");
});
it("uses exact, base-language and English movie titles before the source fallback", () => {
  const movie = {
    title: "Source title",
    titles: { pt: "Título", en: "English title", ja: "日本語の題名" },
  };
  expect(titleOf(movie, "ja")).toBe("日本語の題名");
  expect(titleOf(movie, "pt-BR")).toBe("Título");
  expect(titleOf(movie, "de")).toBe("English title");
  expect(titleOf({ title: "Source title", titles: {} }, "fr")).toBe("Source title");
});
it.each(["es", "de", "fr", "ja", "pt-BR"] as const)(
  "localizes catalog labels and preserves historical countries in %s",
  (locale) => {
    const soviet = countryName({ id: "iso:SU", name: "Russia", names: {} }, locale);
    const russia = countryName({ id: "Q159", name: "Russia", names: {} }, locale);
    expect(soviet).not.toBe(russia);
    expect(soviet).not.toBe("Russia");
    expect(packName({ id: "country-russia-ussr", name: { en: "Russia & USSR" } }, locale)).not.toBe(
      "Russia & USSR",
    );
    expect(shareText(game, dictionaries[locale])).toContain(dictionaries[locale].daily);
  },
);
it("translates genres and countries by identity rather than translating proper names", () => {
  expect(entityName({ id: "Q188473", name: "Action", names: {} }, "es")).toBe("Acción");
  expect(entityName({ id: "Q130232", name: "Drama", names: {} }, "fr")).toBe("Drame");
  expect(entityName({ id: "subgenre:spy", name: "Spy film", names: {} }, "ja")).toBe("スパイ映画");
  expect(countryName({ id: "Q30", name: "United States", names: {} }, "de")).toBe(
    "Vereinigte Staaten",
  );
  expect(entityName({ id: "person", name: "Source", names: { en: "Known Name" } }, "pt-BR")).toBe(
    "Known Name",
  );
});
