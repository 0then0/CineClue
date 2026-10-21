import { expect, it, vi } from "vitest";
import { WikidataProvider } from "./wikidata.ts";

it("normalizes release variants, localized aliases, entities and credited cast order", async () => {
  const film = { value: "http://www.wikidata.org/entity/Q123" };
  const row = (property: string, value: string, extras: Record<string, unknown> = {}) => ({
    film,
    property: {
      value: property.startsWith("http")
        ? property
        : `http://www.wikidata.org/prop/direct/${property}`,
    },
    value: { value },
    ...extras,
  });
  const rows = [
    row("http://www.w3.org/2000/01/rdf-schema#label", "Test", {
      value: { value: "Test", "xml:lang": "en" },
    }),
    row("http://www.w3.org/2000/01/rdf-schema#label", "Тест", {
      value: { value: "Тест", "xml:lang": "ru" },
    }),
    row("http://www.w3.org/2004/02/skos/core#altLabel", "Альтернатива"),
    row("P1476", "Original"),
    row("P577", "2002-01-01T00:00:00Z"),
    row("P577", "2001-12-31T00:00:00Z"),
    row("P2047", "120"),
    row("P2047", "130"),
    row("P2047", "125"),
    row("P57", "http://www.wikidata.org/entity/Q1", { en: { value: "Director" } }),
    ...["P136", "P495", "P272"].map((p, i) =>
      row(p, `http://www.wikidata.org/entity/Q${i + 2}`, { en: { value: `Entity ${i}` } }),
    ),
    ...[3, 1, 2, 5, 4, 6].map((i) =>
      row("P161", `http://www.wikidata.org/entity/Q${i + 10}`, {
        en: { value: `Actor ${i}` },
        ru: { value: `Актёр ${i}` },
        order: { value: String(i) },
      }),
    ),
  ];
  const [movie] = await new WikidataProvider().normalize(rows);
  expect(movie.releaseYear).toBe(2001);
  expect(movie.runtime).toBe(125);
  expect(movie.titles.ru).toBe("Тест");
  expect(movie.aliases).toContain("Альтернатива");
  expect(movie.actors.map((a) => a.name)).toEqual([
    "Actor 1",
    "Actor 2",
    "Actor 3",
    "Actor 4",
    "Actor 5",
  ]);
  expect(movie.provenance[0].license).toBe("CC0-1.0");
});
it("rejects incomplete provider records rather than filling fictional attributes", async () => {
  expect(
    await new WikidataProvider().normalize([
      {
        film: { value: "http://www.wikidata.org/entity/Q1" },
        property: { value: "http://www.wikidata.org/prop/direct/P2047" },
        value: { value: "120" },
      },
    ]),
  ).toEqual([]);
});

it("imports original voice actors for animation and ignores explicitly dubbed-language credits", async () => {
  const film = { value: "http://www.wikidata.org/entity/Q123" };
  const row = (property: string, value: string, extra: Record<string, unknown> = {}) => ({
    film,
    property: { value: `http://www.wikidata.org/prop/direct/${property}` },
    value: { value },
    ...extra,
  });
  const language = { value: "http://www.wikidata.org/entity/Q1860" };
  const rows = [
    {
      film,
      property: { value: "http://www.w3.org/2000/01/rdf-schema#label" },
      value: { value: "Animation", "xml:lang": "en" },
    },
    row("P577", "2000-01-01T00:00:00Z"),
    row("P2047", "100"),
    ...["P57", "P136", "P495", "P272"].map((p, i) =>
      row(p, `http://www.wikidata.org/entity/Q${i + 1}`, { en: { value: p } }),
    ),
    ...[1, 2, 3].map((i) =>
      row("P725", `http://www.wikidata.org/entity/Q${100 + i}`, {
        en: { value: `Voice ${i}` },
        order: { value: String(i) },
        language,
        originalLanguage: language,
      }),
    ),
    row("P725", "http://www.wikidata.org/entity/Q999", {
      en: { value: "Dub actor" },
      language: { value: "http://www.wikidata.org/entity/Q7737" },
      originalLanguage: language,
    }),
  ];
  const [movie] = await new WikidataProvider().normalize(rows);
  expect(movie.actors.map((actor) => actor.name)).toEqual(["Voice 1", "Voice 2", "Voice 3"]);
  expect(movie.actors.some((actor) => actor.id === "Q999")).toBe(false);
});

it("projects voice-language qualifiers on the network load path", async () => {
  const stop = new Error("stop after inspecting the request");
  let query = "";
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    query = new URL(String(input)).searchParams.get("query") ?? "";
    throw stop;
  });
  try {
    await expect(new WikidataProvider().load()).rejects.toBe(stop);
    const projection = query.split("WHERE")[0];
    expect(projection).toContain("?language");
    expect(projection).toContain("?originalLanguage");
  } finally {
    fetcher.mockRestore();
  }
});

it("does not manufacture principal cast from unordered source credits", async () => {
  const film = { value: "http://www.wikidata.org/entity/Q123" };
  const rows = [
    {
      film,
      property: { value: "http://www.w3.org/2000/01/rdf-schema#label" },
      value: { value: "Film", "xml:lang": "en" },
    },
    ...[
      ["P577", "2000-01-01T00:00:00Z"],
      ["P2047", "100"],
    ].map(([p, v]) => ({
      film,
      property: { value: `http://www.wikidata.org/prop/direct/${p}` },
      value: { value: v },
    })),
    ...["P57", "P136", "P495", "P272", "P161", "P161", "P161"].map((p, i) => ({
      film,
      property: { value: `http://www.wikidata.org/prop/direct/${p}` },
      value: { value: `http://www.wikidata.org/entity/Q${i + 1}` },
      en: { value: `Person ${i}` },
    })),
  ];
  expect(await new WikidataProvider().normalize(rows)).toEqual([]);
});
