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
