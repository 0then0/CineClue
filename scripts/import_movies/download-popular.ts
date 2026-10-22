import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { mapConcurrent, TmdbClient } from "./providers/tmdb-client.ts";

const directory = resolve(process.argv[2] ?? "/tmp/cineclue-expansion");
const token = process.env.TMDB_API_TOKEN;
if (!token) throw new Error("TMDB_API_TOKEN is required");
const client = new TmdbClient(token, resolve(directory, "responses"));
const candidate = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  vote_count: z.number(),
  popularity: z.number(),
  genre_ids: z.array(z.number()),
  original_language: z.string(),
  release_date: z.string(),
});
const pageSchema = z.object({ total_pages: z.number(), results: z.array(candidate) });
type Candidate = z.infer<typeof candidate>;
const selections: { name: string; pages: number; params: Record<string, string> }[] = [
  { name: "votes", pages: 500, params: { sort_by: "vote_count.desc", "vote_count.gte": "25" } },
  {
    name: "russian",
    pages: 70,
    params: { sort_by: "vote_count.desc", with_original_language: "ru", "vote_count.gte": "25" },
  },
  {
    name: "animation",
    pages: 80,
    params: { sort_by: "vote_count.desc", with_genres: "16", "vote_count.gte": "25" },
  },
  {
    name: "classics",
    pages: 70,
    params: {
      sort_by: "vote_count.desc",
      "primary_release_date.lte": "1969-12-31",
      "vote_count.gte": "25",
    },
  },
  {
    name: "recent",
    pages: 30,
    params: {
      sort_by: "popularity.desc",
      "primary_release_date.gte": "2025-01-01",
      "vote_count.gte": "100",
    },
  },
];
const candidates = new Map<number, Candidate>();
const groups: Record<string, number[]> = {};
const today = new Date().toISOString().slice(0, 10);
for (const selection of selections) {
  const params = {
    include_adult: "false",
    include_video: "false",
    "primary_release_date.lte": today,
    ...selection.params,
  };
  const first = pageSchema.parse(await client.get("discover/movie", { ...params, page: "1" }));
  const count = Math.min(selection.pages, first.total_pages, 500);
  const pages = [
    first,
    ...(await mapConcurrent(
      Array.from({ length: count - 1 }, (_, i) => i + 2),
      async (page) =>
        pageSchema.parse(await client.get("discover/movie", { ...params, page: String(page) })),
    )),
  ];
  groups[selection.name] = pages.flatMap((page) => page.results.map((movie) => movie.id));
  for (const page of pages) for (const movie of page.results) candidates.set(movie.id, movie);
  console.log(
    `${selection.name}: ${groups[selection.name]?.length} candidates; ${candidates.size} unique total`,
  );
}
// Include every original film, even when it falls outside current discovery rankings.
const identity = z
  .object({ identities: z.record(z.string(), z.string()) })
  .parse(JSON.parse(await readFile(resolve(directory, "identities.json"), "utf8")));
for (const [key] of Object.entries(identity.identities).filter(([key]) => /^tmdb:\d+$/.test(key))) {
  const id = Number(key.slice(5));
  if (!candidates.has(id))
    candidates.set(id, {
      id,
      title: "seed",
      vote_count: 0,
      popularity: 0,
      genre_ids: [],
      original_language: "",
      release_date: "",
    });
}
await mkdir(directory, { recursive: true });
await writeFile(
  resolve(directory, "candidates.json"),
  JSON.stringify({ retrievedAt: today, groups, movies: [...candidates.values()] }),
);
let completed = 0;
const errors: { id: number; error: string }[] = [];
const output = resolve(directory, "details.jsonl");
const handle = await open(`${output}.tmp`, "w");
let writes = Promise.resolve();
try {
  await mapConcurrent([...candidates.values()], async (candidate) => {
    try {
      const value = await client.get(`movie/${candidate.id}`, {
        append_to_response: "credits,translations,alternative_titles,keywords,external_ids",
        language: "en-US",
      });
      const line = `${JSON.stringify(value)}\n`;
      writes = writes.then(async () => {
        await handle.writeFile(line);
      });
      await writes;
      completed++;
      if (completed % 100 === 0) console.log(`Details: ${completed}/${candidates.size}`);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("HTTP 404")) throw error;
      errors.push({ id: candidate.id, error: error.message });
    }
  });
  await writes;
} finally {
  await handle.close();
}
await rename(`${output}.tmp`, output);
const manifest = resolve(directory, "details.json");
await writeFile(
  `${manifest}.tmp`,
  JSON.stringify({
    retrievedAt: today,
    groups,
    candidates: [...candidates.values()],
    count: completed,
    errors,
  }),
);
await rename(`${manifest}.tmp`, manifest);
console.log(`Downloaded ${completed} film details; ${errors.length} removed records`);
