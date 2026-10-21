import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { type Entity, type Movie, movieSchema } from "../../packages/game-engine/src/model.ts";

export type IdentityData = {
  identities: Record<string, string>;
  entities: Record<string, Entity>;
  ambiguous: string[];
};
// Explicit equivalent film genres. Music is broader than musical film and retains its TMDB ID.
export const genreIds: Record<number, string> = {
  28: "Q188473",
  12: "Q319221",
  16: "Q202866",
  35: "Q157443",
  80: "Q959790",
  99: "Q93204",
  18: "Q130232",
  10751: "Q1361932",
  14: "Q157394",
  36: "Q17013749",
  9648: "Q1200678",
  10749: "Q1054574",
  878: "Q471839",
  10770: "Q506240",
  53: "Q2484376",
  10752: "Q369747",
  37: "Q172980",
  27: "Q200092",
};
const binding = z.object({
  item: z.object({ value: z.string() }),
  property: z.object({ value: z.string() }).optional(),
  value: z.object({ value: z.string() }).optional(),
  en: z.object({ value: z.string() }).optional(),
  ru: z.object({ value: z.string() }).optional(),
});
const responseSchema = z.object({ results: z.object({ bindings: z.array(binding) }) });
const prefix: Record<string, string> = {
  P4947: "tmdb:",
  P4985: "tmdb:person:",
  P11806: "tmdb:studio:",
  P297: "iso:",
};
export function identityData(rows: z.infer<typeof binding>[], movies: Movie[]): IdentityData {
  const entities: Record<string, Entity> = Object.fromEntries(
    movies
      .flatMap((m) => [...m.actors, ...m.directors, ...m.countries, ...m.genres, ...m.studios])
      .map((e) => [e.id, e]),
  );
  const matches = new Map<string, Set<string>>();
  for (const row of rows) {
    const id = row.item.value.split("/").pop();
    if (!id || !/^Q\d+$/.test(id)) continue;
    const names = {
      ...entities[id]?.names,
      ...(row.en ? { en: row.en.value } : {}),
      ...(row.ru ? { ru: row.ru.value } : {}),
    };
    if (!entities[id] && (row.en || row.ru))
      entities[id] = { id, name: row.en?.value ?? row.ru?.value ?? id, names };
    const property = row.property?.value.split("/").pop() ?? "";
    if (!prefix[property] || !row.value) continue;
    const key = `${prefix[property]}${row.value.value}`;
    const values = matches.get(key) ?? new Set<string>();
    values.add(id);
    matches.set(key, values);
  }
  const identities: Record<string, string> = {};
  const ambiguous: string[] = [];
  for (const [key, values] of matches) {
    if (values.size === 1) identities[key] = [...values][0] ?? "";
    else ambiguous.push(key);
  }
  for (const [tmdb, id] of Object.entries(genreIds)) identities[`tmdb:genre:${tmdb}`] = id;
  return { identities, entities, ambiguous };
}
export async function collectIdentities(movies: Movie[], directory: string): Promise<IdentityData> {
  const ids = [
    ...new Set([
      ...Object.values(genreIds),
      ...movies.flatMap((m) => [
        m.id,
        ...[...m.actors, ...m.directors, ...m.countries, ...m.studios].map((e) => e.id),
      ]),
    ]),
  ]
    .filter((id) => /^Q\d+$/.test(id))
    .sort();
  await mkdir(directory, { recursive: true });
  const rows: z.infer<typeof binding>[] = [];
  for (let offset = 0; offset < ids.length; offset += 150) {
    const query = `SELECT ?item ?property ?value ?en ?ru WHERE { VALUES ?item { ${ids
      .slice(offset, offset + 150)
      .map((id) => `wd:${id}`)
      .join(
        " ",
      )} } OPTIONAL { VALUES ?property { wdt:P4947 wdt:P4985 wdt:P11806 wdt:P297 } ?item ?property ?value. } OPTIONAL { ?item rdfs:label ?en. FILTER(LANG(?en)="en") } OPTIONAL { ?item rdfs:label ?ru. FILTER(LANG(?ru)="ru") } }`;
    const file = resolve(directory, `${createHash("sha256").update(query).digest("hex")}.json`);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(file, "utf8"));
    } catch {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const url = new URL("https://query.wikidata.org/sparql");
          url.search = new URLSearchParams({ query, format: "json" }).toString();
          const response = await fetch(url, {
            headers: {
              Accept: "application/sparql-results+json",
              "User-Agent": "CineClue/0.1 (open-source catalog importer)",
            },
            signal: AbortSignal.timeout(60000),
          });
          if (!response.ok) throw new Error(`Wikidata HTTP ${response.status}`);
          raw = await response.json();
          responseSchema.parse(raw);
          await writeFile(file, JSON.stringify(raw));
          break;
        } catch (error) {
          if (attempt === 4) throw error;
          await delay(3000 * 2 ** attempt);
        }
      }
      await delay(500);
    }
    rows.push(...responseSchema.parse(raw).results.bindings);
    console.log(`Identities: ${Math.min(offset + 150, ids.length)}/${ids.length}`);
  }
  return identityData(rows, movies);
}
if (import.meta.main) {
  const movies = z
    .array(movieSchema)
    .parse(JSON.parse(await readFile("data/seed/movies.json", "utf8")));
  const directory = resolve(process.argv[2] ?? "/tmp/cineclue-expansion");
  const data = await collectIdentities(movies, resolve(directory, "wikidata"));
  await writeFile(resolve(directory, "identities.json"), JSON.stringify(data));
  console.log(
    `Mapped ${Object.keys(data.identities).length} identifiers, ${data.ambiguous.length} ambiguous excluded`,
  );
}
