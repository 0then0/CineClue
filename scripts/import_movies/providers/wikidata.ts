import { readFile } from "node:fs/promises";
import { z } from "zod";
import { type Entity, type Movie, movieSchema } from "../../../packages/game-engine/src/index.ts";
import type { MovieProvider } from "./types.ts";

const cell = z.object({ value: z.string(), "xml:lang": z.string().optional() });
const binding = z.object({
  film: cell,
  property: cell,
  value: cell,
  en: cell.optional(),
  ru: cell.optional(),
  order: cell.optional(),
  language: cell.optional(),
  originalLanguage: cell.optional(),
});
const response = z.object({ results: z.object({ bindings: z.array(binding) }) });
type Row = z.infer<typeof binding>;
const local = (url: string) => url.split("/").at(-1) ?? url;
const P = {
  label: "http://www.w3.org/2000/01/rdf-schema#label",
  alias: "http://www.w3.org/2004/02/skos/core#altLabel",
  sites: "http://wikiba.se/ontology#sitelinks",
};
export class WikidataProvider implements MovieProvider {
  readonly name = "wikidata";
  readonly input?: string;
  constructor(input?: string) {
    this.input = input;
  }
  async load(): Promise<Row[]> {
    if (this.input)
      return response.parse(JSON.parse(await readFile(this.input, "utf8"))).results.bindings;
    const ids = z
      .array(z.string().regex(/^Q\d+$/))
      .parse(
        JSON.parse(
          await readFile(new URL("../../../data/seed/wikidata-ids.json", import.meta.url), "utf8"),
        ),
      );
    const out: Row[] = [];
    for (let offset = 0; offset < ids.length; offset += 250) {
      const batch = ids.slice(offset, offset + 250);
      const query = `SELECT ?film ?property ?value ?en ?ru ?order ?language ?originalLanguage WHERE { VALUES ?film { ${batch.map((id) => `wd:${id}`).join(" ")} } VALUES ?property { rdfs:label skos:altLabel wdt:P1476 wdt:P577 wdt:P2047 wdt:P57 wdt:P161 wdt:P725 wdt:P136 wdt:P495 wdt:P272 wikibase:sitelinks } ?film ?property ?value. FILTER(?property NOT IN (rdfs:label,skos:altLabel) || LANG(?value) IN ("en","ru")) OPTIONAL { ?film p:P161 ?castStatement. ?castStatement ps:P161 ?value; pq:P1545 ?order. FILTER(?property=wdt:P161) } OPTIONAL { ?film p:P725 ?voiceStatement. ?voiceStatement ps:P725 ?value. OPTIONAL { ?voiceStatement pq:P1545 ?order. } OPTIONAL { ?voiceStatement pq:P407 ?language. } FILTER(?property=wdt:P725) } OPTIONAL { ?film wdt:P364 ?originalLanguage. } OPTIONAL { ?value rdfs:label ?en. FILTER(LANG(?en)="en") } OPTIONAL { ?value rdfs:label ?ru. FILTER(LANG(?ru)="ru") } }`;
      const url = new URL(process.env.WIKIDATA_ENDPOINT ?? "https://query.wikidata.org/sparql");
      url.searchParams.set("query", query);
      url.searchParams.set("format", "json");
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await fetch(url, {
          headers: {
            "User-Agent": "CineClue/0.1 (open-source movie game)",
            Accept: "application/sparql-results+json",
          },
          signal: AbortSignal.timeout(120000),
        });
        if (r.ok) {
          out.push(...response.parse(await r.json()).results.bindings);
          console.log(
            `Wikidata: fetched ${Math.min(offset + 250, ids.length)}/${ids.length} candidates`,
          );
          break;
        }
        if (![429, 502, 503, 504].includes(r.status) || attempt === 2)
          throw new Error(
            `Wikidata HTTP ${r.status}. Retry later or use --input saved-response.json.`,
          );
        console.log(`Wikidata HTTP ${r.status}; waiting 60s before retry`);
        await new Promise((resolve) => setTimeout(resolve, 60000));
      }
      if (offset + 250 < ids.length) await new Promise((resolve) => setTimeout(resolve, 60000));
    }
    return out;
  }
  async normalize(raw: unknown[]): Promise<Movie[]> {
    const rows = z.array(binding).parse(raw);
    const originalVoice = (r: Row) =>
      local(r.property.value) !== "P725" ||
      !r.language ||
      !r.originalLanguage ||
      r.language.value === r.originalLanguage.value;
    const grouped = Map.groupBy(rows.filter(originalVoice), (r) => local(r.film.value));
    const result: Movie[] = [];
    let rejected = 0;
    for (const [id, entries] of grouped) {
      const props = (p: string) =>
        entries.filter((r) => r.property.value === p || local(r.property.value) === p);
      const entities = (p: string): Entity[] => [
        ...new Map(
          props(p)
            .filter((r) => r.en || r.ru)
            .map((r) => [
              local(r.value.value),
              {
                id: local(r.value.value),
                name: r.en?.value ?? r.ru?.value ?? "",
                names: { ...(r.en ? { en: r.en.value } : {}), ...(r.ru ? { ru: r.ru.value } : {}) },
              },
            ]),
        ).values(),
      ];
      const titles = Object.fromEntries(
        props(P.label).map((r) => [r.value["xml:lang"] ?? "en", r.value.value]),
      );
      const runtimes = [
        ...new Set(
          props("P2047")
            .map((r) => Number(r.value.value))
            .filter((n) => Number.isFinite(n) && n >= 40 && n <= 400),
        ),
      ].sort((a, b) => a - b);
      const years = props("P577")
        .map((r) => Number(r.value.value.match(/^\+?(\d{4})/)?.[1]))
        .filter((n) => n >= 1880 && n <= new Date().getUTCFullYear())
        .sort((a, b) => a - b);
      const creditOrder = new Map(
        [...props("P161"), ...props("P725")]
          .filter((r) => r.order && Number.isFinite(Number(r.order.value)))
          .map((r) => [local(r.value.value), Number(r.order?.value)]),
      );
      const parsed = movieSchema.safeParse({
        id,
        title: titles.en ?? titles.ru,
        originalTitle: props("P1476")[0]?.value.value ?? titles.en ?? titles.ru,
        titles,
        aliases: [...new Set(props(P.alias).map((r) => r.value.value))],
        releaseYear: years[0],
        runtime: runtimes.length
          ? Math.round(runtimes[Math.floor(runtimes.length / 2)])
          : undefined,
        directors: entities("P57"),
        actors: [
          ...new Map(
            [...entities("P161"), ...entities("P725")].map((actor) => [actor.id, actor]),
          ).values(),
        ]
          .filter((actor) => creditOrder.has(actor.id))
          .sort((a, b) => (creditOrder.get(a.id) ?? 1e9) - (creditOrder.get(b.id) ?? 1e9))
          .slice(0, 5),
        genres: entities("P136"),
        countries: entities("P495"),
        studios: entities("P272"),
        externalIds: { wikidata: id },
        popularityScore: Math.min(100, Math.round(Number(props(P.sites)[0]?.value.value ?? 0) / 2)),
        provenance: [
          {
            provider: "wikidata",
            url: `https://www.wikidata.org/wiki/${id}`,
            license: "CC0-1.0",
            retrievedAt: new Date().toISOString().slice(0, 10),
          },
        ],
      });
      if (parsed.success && parsed.data.actors.length >= 3) result.push(parsed.data);
      else rejected++;
    }
    console.log(
      `Wikidata: ${result.length} complete films, ${rejected} incomplete candidates excluded.`,
    );
    return result;
  }
}
