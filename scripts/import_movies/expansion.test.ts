import { expect, it } from "vitest";
import { Catalog } from "../../apps/api/src/catalog.ts";
import { compareMovies } from "../../packages/game-engine/src/index.ts";
import type { Movie } from "../../packages/game-engine/src/model.ts";
import {
  type Candidate,
  enrichSeedCast,
  importedMedia,
  normalizeExpanded,
  popularity,
  selectExpanded,
} from "./expansion.ts";
import { identityData } from "./identities.ts";
import { preservesSeed, readSnapshot } from "./snapshot.ts";

const candidate: Candidate = {
  id: 1,
  vote_count: 1000,
  popularity: 5,
  original_language: "en",
  genre_ids: [18],
  release_date: "2000-01-01",
};
const raw = {
  id: 1,
  title: "Film",
  original_title: "Film",
  release_date: "2000-01-01",
  runtime: 100,
  popularity: 5,
  imdb_id: "tt0000001",
  adult: false,
  video: false,
  status: "Released",
  genres: [{ id: 18, name: "Drama" }],
  production_companies: [{ id: 10, name: "Studio" }],
  production_countries: [{ iso_3166_1: "US", name: "United States" }],
  credits: {
    cast: [1, 2, 3].map((id) => ({ id, name: `Actor ${id}` })),
    crew: [{ id: 4, name: "Director", job: "Director" }],
  },
  translations: {
    translations: [
      { iso_639_1: "ru", data: { title: "Фильм" } },
      { iso_639_1: "fr", data: { title: "Film français" } },
    ],
  },
  alternative_titles: {
    titles: [
      { title: "Alias", iso_3166_1: "US" },
      { title: "French alias", iso_3166_1: "FR" },
    ],
  },
};
const identities = {
  identities: { "tmdb:person:1": "Q1", "iso:US": "Q30", "tmdb:genre:18": "Q130232" },
  entities: { Q1: { id: "Q1", name: "Actor One", names: { en: "Actor One", ru: "Первый актёр" } } },
  ambiguous: [],
};
async function movie(id = "base") {
  return { ...(await normalizeExpanded(raw, candidate, identities)), id };
}
it("normalizes complete films with canonical identities and traceable TMDB provenance", async () => {
  const result = await normalizeExpanded(raw, candidate, identities);
  expect(result.actors[0]).toEqual(identities.entities.Q1);
  expect(result.countries[0]?.id).toBe("Q30");
  expect(result.countries[0]?.names.ru).toBe("Соединенные Штаты");
  expect(result.genres[0]?.id).toBe("Q130232");
  expect(result.titles.ru).toBe("Фильм");
  expect(result.titles.fr).toBeUndefined();
  expect(result.aliases).toEqual(["Alias"]);
  expect(result.popularityScore).toBe(popularity(1000));
  expect(result.provenance[0]?.license).toBe("TMDB-terms");
});
it.each([
  { ...raw, runtime: 0 },
  { ...raw, adult: true },
  { ...raw, credits: { ...raw.credits, cast: [] } },
])("rejects incomplete or unsuitable film data", async (invalid) => {
  await expect(normalizeExpanded(invalid, candidate, identities)).rejects.toThrow();
});
it("preserves original records and ranks additions without merging equal titles", async () => {
  const base = await movie("Qoriginal");
  const before = structuredClone(base);
  const films = await Promise.all(
    [2, 3, 4].map(async (id) => ({ ...(await movie(`tmdb:${id}`)), releaseYear: 2000 })),
  );
  const candidates = [2, 3, 4].map((id) => ({ ...candidate, id, vote_count: id * 100 }));
  const result = selectExpanded([base], films, candidates, 3);
  expect(result.find((m) => m.id === base.id)).toEqual(before);
  expect(result.map((m) => m.id)).toEqual(["Qoriginal", "tmdb:3", "tmdb:4"]);
  expect(() => selectExpanded([base], films, candidates, 5)).toThrow("Only 4/5");
});
it("reserves room for Russian films, animation and classics", async () => {
  const films = await Promise.all(
    [2, 3, 4, 5].map(async (id) => ({
      ...(await movie(`tmdb:${id}`)),
      releaseYear: id === 4 ? 1960 : 2000,
    })),
  );
  const candidates = [2, 3, 4, 5].map((id) => ({
    ...candidate,
    id,
    original_language: id === 2 ? "ru" : "en",
    genre_ids: [id === 3 ? 16 : 18],
    vote_count: id === 5 ? 100000 : 50,
  }));
  expect(selectExpanded([await movie()], films, candidates, 4).map((m) => m.id)).toEqual([
    "base",
    "tmdb:2",
    "tmdb:3",
    "tmdb:4",
  ]);
});
it("excludes ambiguous authoritative ID mappings instead of guessing by name", () => {
  const rows = ["Q1", "Q2"].map((id) => ({
    item: { value: `http://www.wikidata.org/entity/${id}` },
    property: { value: "http://www.wikidata.org/prop/direct/P11806" },
    value: { value: "10" },
  }));
  const data = identityData(rows, []);
  expect(data.identities["tmdb:studio:10"]).toBeUndefined();
  expect(data.ambiguous).toEqual(["tmdb:studio:10"]);
});
it("keeps obscure connected films searchable but out of easy and normal target pools", async () => {
  const template = await movie();
  const films: Movie[] = Array.from({ length: 15 }, (_, i) => ({
    ...template,
    id: `film${i}`,
    popularityScore: i === 0 ? 20 : 80,
  }));
  const catalog = new Catalog(films, [
    { id: "popular", name: { en: "All" }, description: {}, rules: {} },
  ]);
  expect(catalog.search("Film", 20).some((m) => m.id === "film0")).toBe(true);
  expect(catalog.candidates("easy").some((m) => m.id === "film0")).toBe(false);
  expect(catalog.candidates("normal").some((m) => m.id === "film0")).toBe(false);
  expect(catalog.candidates("hard").some((m) => m.id === "film0")).toBe(true);
});

it("enriches cast and genre profiles while preserving other seed facts", async () => {
  const original = await movie("Qoriginal");
  const before = structuredClone(original);
  const enriched = enrichSeedCast(
    original,
    {
      ...raw,
      credits: {
        ...raw.credits,
        cast: [4, 2, 1].map((id) => ({ id, name: `Actor ${id}`, order: id })),
      },
    },
    identities,
    "2026-10-21",
  );
  expect(enriched.actors.map((p) => p.id)).toEqual(["Q1", "tmdb:person:2", "tmdb:person:4"]);
  expect(original).toEqual(before);
  expect(preservesSeed(original, enriched)).toBe(true);
  expect(preservesSeed(original, { ...enriched, runtime: 999 })).toBe(false);
  expect(preservesSeed(original, { ...enriched, provenance: original.provenance })).toBe(false);
});
it("compares the real credited principal cast of Frozen and Frozen II", async () => {
  const { movies } = await readSnapshot();
  const target = movies.find((m) => m.id === "Q246283");
  const guess = movies.find((m) => m.id === "Q24733929");
  if (!target || !guess) throw new Error("Missing regression films");
  const actors = compareMovies(guess, target).actors;
  expect(actors.status).toBe("partial");
  expect(actors.matches.map((p) => p.id).sort()).toEqual(
    ["Q178882", "Q157400", "Q1190319", "Q556644"].sort(),
  );
});

it("retains Wikidata popularity thresholds after cast-only TMDB enrichment", async () => {
  const template = await movie();
  const films = Array.from({ length: 15 }, (_, i) => ({
    ...template,
    id: `original${i}`,
    popularityScore: 20,
    provenance: [
      {
        provider: "wikidata",
        url: "https://www.wikidata.org/wiki/Q1",
        license: "CC0-1.0",
        retrievedAt: "2026-10-21",
      },
      ...template.provenance,
    ],
  }));
  const catalog = new Catalog(films, [
    { id: "popular", name: { en: "All" }, description: {}, rules: {} },
  ]);
  expect(catalog.candidates("easy")).toHaveLength(15);
});

it("publishes attributed image metadata with canonical people and country IDs", async () => {
  const film = await movie();
  const media = importedMedia(
    {
      ...raw,
      poster_path: "/poster.jpg",
      production_companies: [
        { id: 10, name: "Studio", logo_path: "/logo.png" },
        { id: 999, name: "Unrelated", logo_path: "/wrong.png" },
      ],
      credits: {
        ...raw.credits,
        cast: raw.credits.cast.map((p) => ({ ...p, profile_path: `/${p.id}.jpg` })),
      },
    },
    film,
    identities,
  );
  expect(Object.keys(media.studios ?? {})).toEqual([film.studios[0].id]);
  expect(media.studios?.[film.studios[0].id].source).toBe("https://www.themoviedb.org/company/10");
  expect(media.poster?.provider).toBe("tmdb");
  expect(media.people.Q1.source).toBe("https://www.themoviedb.org/person/1");
  expect(media.countries.Q30).toBe("US");
  expect(media.people.Q1.url).toContain("image.tmdb.org");
});

it.each([
  ["SU", "Soviet Union", "СССР"],
  ["DD", "East Germany", "ГДР"],
  ["YU", "Yugoslavia", "Югославия"],
  ["CS", "Serbia and Montenegro", "Сербия и Черногория"],
  ["CS", "Czechoslovakia", "Чехословакия"],
])(
  "imports historical country %s with its original identity and Russian name",
  async (code, name, ru) => {
    const result = await normalizeExpanded(
      { ...raw, production_countries: [{ iso_3166_1: code, name }] },
      candidate,
      {
        ...identities,
        identities: { ...identities.identities, [`iso:${code}`]: "Q159" },
        entities: {
          ...identities.entities,
          Q159: { id: "Q159", name: "Russia", names: { en: "Russia", ru: "Россия" } },
        },
      },
    );
    expect(result.countries).toEqual([{ id: `iso:${code}`, name, names: { en: name, ru } }]);
  },
);
