import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { movieSchema } from "../../packages/game-engine/src/model.ts";
import { mergeMovies } from "./merge.ts";

const original = movieSchema.parse(
  JSON.parse(readFileSync(new URL("../../data/seed/movies.json", import.meta.url), "utf8"))[0],
);
it("merges shared external identities, preserves aliases and provenance", () => {
  const duplicate = {
    ...original,
    id: "other",
    aliases: ["An alternate title"],
    titles: { ru: "Другое название" },
  };
  const result = mergeMovies([original, duplicate]);
  expect(result).toHaveLength(1);
  expect(result[0].aliases).toContain("An alternate title");
  expect(result[0].externalIds).toEqual(original.externalIds);
});
it("does not merge remakes by title and maps people only by explicit identity", () => {
  const remake = {
    ...original,
    id: "remake",
    releaseYear: 2025,
    externalIds: { tmdb: "other" },
    actors: [{ id: "tmdb:person:1", name: original.actors[0].name, names: {} }],
  };
  const result = mergeMovies([original, remake], { "tmdb:person:1": original.actors[0].id });
  expect(result).toHaveLength(2);
  expect(result.find((m) => m.id === "remake")?.actors[0].id).toBe(original.actors[0].id);
});
it("preserves localized person labels when another provider has only English", () => {
  const first = {
    ...original,
    actors: [{ id: "person:1", name: "Person", names: { ru: "Актёр" } }],
  };
  const other = {
    ...original,
    id: "other",
    actors: [{ id: "external:1", name: "Person", names: { en: "Person" } }],
  };
  const [merged] = mergeMovies([first, other], { "external:1": "person:1" });
  expect(merged.actors[0].names).toEqual({ ru: "Актёр", en: "Person" });
});
it("unifies transitive duplicate records when a bridge supplies both external IDs", () => {
  const wikidata = {
    ...original,
    id: "wiki",
    externalIds: { wikidata: "Q123" },
    aliases: ["Wiki alias"],
  };
  const tmdb = { ...original, id: "tmdb", externalIds: { tmdb: "456" }, aliases: ["TMDB alias"] };
  const bridge = { ...original, id: "bridge", externalIds: { wikidata: "Q123", tmdb: "456" } };
  const result = mergeMovies([wikidata, tmdb, bridge]);
  expect(result).toHaveLength(1);
  expect(result[0].externalIds).toEqual({ wikidata: "Q123", tmdb: "456" });
  expect(result[0].aliases).toEqual(expect.arrayContaining(["Wiki alias", "TMDB alias"]));
});
