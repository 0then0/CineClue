import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { countryName, normalizeCountry } from "../src/countries.ts";
import { compareMovies, compareSet, type Entity, type Movie } from "../src/index.ts";

it.each([
  ["SU", "Soviet Union", "Россия", "СССР"],
  ["DD", "East Germany", "Германия", "ГДР"],
  ["YU", "Yugoslavia", "Сербия", "Югославия"],
  ["CS", "Serbia and Montenegro", "Сербия", "Сербия и Черногория"],
  ["CS", "Czechoslovakia", "Чехия", "Чехословакия"],
])(
  "preserves the historical identity of %s (%s) without changing its input",
  (code, name, wrong, corrected) => {
    const entity = { id: `iso:${code}`, name, names: { en: name, ru: wrong, fr: "Original" } };
    const before = structuredClone(entity);
    const result = normalizeCountry(entity);
    expect(result.id).toBe(entity.id);
    expect(result.names.ru).toBe(corrected);
    expect(result.names.fr).toBe("Original");
    expect(countryName(entity, "ru")).toBe(corrected);
    expect(countryName(entity, "en")).toBe(name);
    expect(entity).toEqual(before);
    expect(normalizeCountry(result)).toEqual(result);
  },
);
it("leaves Russia and known canonical historical entities unchanged", () => {
  for (const entity of [
    { id: "Q159", name: "Russia", names: { ru: "Россия" } },
    { id: "iso:RU", name: "Russia", names: { ru: "Россия" } },
    { id: "Q15180", name: "Soviet Union", names: { ru: "СССР" } },
  ])
    expect(normalizeCountry(entity)).toBe(entity);
});
it("does not guess which state CS describes without an explicit source name", () => {
  expect(
    countryName({ id: "iso:CS", name: "Unknown source country", names: { ru: "Сербия" } }, "ru"),
  ).toBe("Unknown source country");
});

const movies = JSON.parse(
  readFileSync(new URL("../../../data/catalog.json", import.meta.url), "utf8"),
).movies as Movie[];
const country = (id: string): Entity => ({ id, name: "Country", names: {} });
const compareCountries = (guess: Entity[], target: Entity[]) =>
  compareMovies({ ...movies[0], countries: guess }, { ...movies[0], countries: target }).countries;
it.each([
  ["iso:SU", "Q15180"],
  ["Q15180", "iso:SU"],
  ["iso:NL", "Q55"],
  ["Q55", "iso:NL"],
])(
  "matches equivalent country IDs %s and %s while retaining the guessed identity",
  (guessId, targetId) => {
    const guess = [country(guessId)],
      target = [country(targetId)];
    const before = structuredClone({ guess, target });
    const result = compareCountries(guess, target);
    expect(result).toEqual({ status: "exact", values: guess, matches: guess });
    expect({ guess, target }).toEqual(before);
    // Identity aliases apply only to countries, never people, studios or genres.
    expect(compareSet(guess, target).status).toBe("miss");
  },
);
it("compares co-productions partially without sending target-only countries", () => {
  const guessed = [country("Q15180"), country("Q30")];
  const result = compareCountries(guessed, [country("iso:SU"), country("Q55")]);
  expect(result.status).toBe("partial");
  expect(result.matches).toEqual([guessed[0]]);
  expect(result.values).toEqual(guessed);
  expect(JSON.stringify(result)).not.toContain("Q55");
});
it("counts aliases once on both sides and keeps modern and historical states distinct", () => {
  expect(compareCountries([country("Q15180"), country("iso:SU")], [country("iso:SU")]).status).toBe(
    "exact",
  );
  expect(compareCountries([country("iso:NL")], [country("Q55"), country("iso:NL")]).status).toBe(
    "exact",
  );
  expect(compareCountries([country("Q159")], [country("iso:SU")]).status).toBe("miss");
  expect(compareCountries([country("iso:RU")], [country("Q15180")]).status).toBe("miss");
  expect(compareCountries([country("Q183")], [country("iso:DD")]).status).toBe("miss");
  expect(compareCountries([country("unknown-a")], [country("unknown-b")]).status).toBe("miss");
});
it("matches the real Soviet films Solaris and The Dawns Here Are Quiet", () => {
  const solaris = movies.find((m) => m.id === "Q125772");
  const dawns = movies.find((m) => m.id === "tmdb:49106");
  if (!solaris || !dawns) throw Error("Missing country regression films");
  expect(compareMovies(solaris, dawns).countries.status).toBe("exact");
  expect(compareMovies(dawns, solaris).countries.status).toBe("exact");
});
it("recognizes Netherlands in real co-productions from both providers", () => {
  const wikidata = movies.find((m) => m.countries.some((c) => c.id === "Q55"));
  const tmdb = movies.find((m) => m.countries.length === 1 && m.countries[0].id === "iso:NL");
  if (!wikidata || !tmdb) throw Error("Missing Netherlands regression films");
  expect(compareMovies(tmdb, wikidata).countries.matches.map((c) => c.id)).toEqual(["iso:NL"]);
  expect(compareMovies(wikidata, tmdb).countries.matches.map((c) => c.id)).toEqual(["Q55"]);
});
