import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Movie } from "../../../packages/game-engine/src/model.ts";

export const MIN_DAILY_VOTES = 5000;
export const dailyPoolSchema = z.object({
  version: z.literal(1),
  retrievedAt: z.iso.date(),
  provider: z.literal("tmdb"),
  movies: z
    .array(z.object({ id: z.string().min(1), votes: z.number().int().min(MIN_DAILY_VOTES) }))
    .min(1),
});
export async function readDailyPool() {
  const snapshot = dailyPoolSchema.parse(
    JSON.parse(await readFile("data/daily-pool.json", "utf8")),
  );
  if (new Set(snapshot.movies.map((m) => m.id)).size !== snapshot.movies.length)
    throw new Error("Duplicate Daily film IDs");
  return new Map(snapshot.movies.map((m) => [m.id, m.votes]));
}
export function dailyIndex(date: string, secret: string, count: number) {
  return Number(
    BigInt(`0x${createHmac("sha256", secret).update(`cineclue:v1:${date}`).digest("hex")}`) %
      BigInt(count),
  );
}
export type RecentDaily = { date: string; movieId: string; directorIds: string[] };
export function selectDaily(
  candidates: Movie[],
  recent: RecentDaily[],
  date: string,
  secret: string,
) {
  if (!candidates.length) return undefined;
  const day = Date.parse(`${date}T00:00:00Z`);
  const history = recent
    .filter((r) => {
      const age = (day - Date.parse(`${r.date}T00:00:00Z`)) / 86400000;
      return age > 0 && age <= 180;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  const seen = new Set(history.map((r) => r.movieId));
  let available = candidates.filter((m) => !seen.has(m.id));
  // A small custom catalog can exhaust its pool. Prefer the least recently
  // featured film, rather than falling back to obscure Unlimited targets.
  if (!available.length) {
    const lastSeen = new Map<string, string>();
    for (const r of [...history].reverse()) lastSeen.set(r.movieId, r.date);
    const oldest = candidates.map((m) => lastSeen.get(m.id) ?? "").sort()[0];
    available = candidates.filter((m) => lastSeen.get(m.id) === oldest);
  }
  const recentDirectors = new Set(
    history
      .filter((r) => day - Date.parse(`${r.date}T00:00:00Z`) <= 7 * 86400000)
      .flatMap((r) => r.directorIds),
  );
  const varied = available.filter((m) => !m.directors.some((d) => recentDirectors.has(d.id)));
  const pool = (varied.length ? varied : available).sort((a, b) => a.id.localeCompare(b.id));
  return pool[dailyIndex(date, secret, pool.length)];
}
