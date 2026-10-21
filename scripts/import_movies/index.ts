import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { movieSchema } from "../../packages/game-engine/src/index.ts";
import { mergeMovies } from "./merge.ts";
import { TmdbProvider } from "./providers/tmdb.ts";
import { WikidataProvider } from "./providers/wikidata.ts";

const arg = (key: string) => {
  const i = process.argv.indexOf(key);
  return i < 0 ? undefined : process.argv[i + 1];
};
const providerName = arg("--provider") ?? "wikidata";
if (!["wikidata", "tmdb"].includes(providerName)) throw new Error("Unknown provider");
const provider =
  providerName === "wikidata"
    ? new WikidataProvider(arg("--input"))
    : new TmdbProvider(
        z
          .array(z.number().int().positive())
          .min(1)
          .parse((arg("--ids") ?? "").split(",").filter(Boolean).map(Number)),
      );
const output =
  arg("--output") ??
  (providerName === "wikidata" ? "data/seed/movies.json" : "data/tmdb.local.json");
const identities = arg("--identities")
  ? z
      .record(z.string(), z.string())
      .parse(JSON.parse(await readFile(arg("--identities") ?? "", "utf8")))
  : {};
const base = arg("--merge")
  ? z.array(movieSchema).parse(JSON.parse(await readFile(arg("--merge") ?? "", "utf8")))
  : [];
const movies = z
  .array(movieSchema)
  .min(1)
  .parse(mergeMovies([...base, ...(await provider.normalize(await provider.load()))], identities));
await writeFile(output, `${JSON.stringify(movies, null, 2)}\n`);
console.log(
  `Saved ${movies.length} validated films to ${output}. Review provenance before redistribution.`,
);
