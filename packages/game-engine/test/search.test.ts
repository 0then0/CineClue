import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { movieSchema } from "../src/model.ts";
import { createSearch, normalize } from "../src/search.ts";

const movies = JSON.parse(
  readFileSync(new URL("../../../data/seed/movies.json", import.meta.url), "utf8"),
).map((m: unknown) => movieSchema.parse(m));
const search = createSearch(movies);
describe("catalog search", () => {
  it("normalizes case, punctuation, diacritics and ё", () => {
    expect(normalize("ЁЛКИ! Amélie")).toBe("елки amelie");
  });
  it("searches Russian, original and alternative titles", () => {
    const m = movies.find(
      (m: ReturnType<typeof movieSchema.parse>) => m.titles.ru && m.aliases.length > 0,
    );
    expect(m).toBeDefined();
    if (!m) return;
    expect(search(m.titles.ru).map((v) => v.id)).toContain(m.id);
    expect(search(m.originalTitle).map((v) => v.id)).toContain(m.id);
    expect(search(m.aliases[0]).map((v) => v.id)).toContain(m.id);
  });
  it("tolerates a typo and never sends attributes or non-catalog records", () => {
    const movie = {
      ...movies[0],
      id: "fixture",
      title: "Interstellar",
      originalTitle: "Interstellar",
      titles: { en: "Interstellar" },
    };
    const result = createSearch([movie])("interstelar");
    expect(result[0]?.id).toBe("fixture");
    expect(result[0]).not.toHaveProperty("actors");
    expect(search("zzqqxxnothingmatches")).toEqual([]);
    expect(search("a")).toEqual([]);
  });
});

describe("multi-word relevance", () => {
  const catalog = JSON.parse(
    readFileSync(new URL("../../../data/catalog.json", import.meta.url), "utf8"),
  ).movies;
  const searchCatalog = createSearch(catalog);
  it.each([
    "легенда о десяти",
    "легенда десяти",
    "десяти легенда",
    "ЛЕГЕНДА О ДЕСЯ",
    "legend of the ten",
  ])("ranks Shang-Chi first for %s", (query) => {
    expect(searchCatalog(query)[0]?.titles.ru).toBe("Шан-Чи и Легенда Десяти Колец");
  });
  it("preserves exact title priority over a longer title containing the same words", () => {
    const base = movies[0];
    const make = (id: string, title: string) => ({
      ...base,
      id,
      title,
      originalTitle: title,
      titles: {},
      aliases: [],
    });
    const result = createSearch([
      make("long", "The Legend of the Ten Rings"),
      make("exact", "Legend Ten"),
    ])("legend ten");
    expect(result.map((m) => m.id)).toEqual(["exact", "long"]);
  });
  it("does not combine query terms from different translations", () => {
    const base = {
      ...movies[0],
      title: "UniqueAlpha",
      originalTitle: "UniqueBeta",
      titles: {},
      aliases: [],
    };
    const relevant = {
      ...base,
      id: "relevant",
      title: "The UniqueAlpha and UniqueBeta",
      originalTitle: "Other",
    };
    expect(createSearch([base, relevant])("uniquealpha uniquebeta")[0]?.id).toBe("relevant");
  });
});
