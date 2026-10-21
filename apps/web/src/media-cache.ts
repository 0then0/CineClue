import { z } from "zod";
import { type MovieMedia, movieMediaSchema } from "../../../packages/game-engine/src/model.ts";
import { readStorage, writeStorage } from "./client.ts";

const key = "cineclue:media:v2";
const cacheSchema = z.record(
  z.string(),
  z.object({ expires: z.number().finite(), media: movieMediaSchema }),
);
const pending = new Map<string, Promise<MovieMedia>>();

function readCache() {
  const parsed = cacheSchema.safeParse(readStorage<unknown>(key, {}));
  return parsed.success ? parsed.data : {};
}
export function cachedMovieMedia(id: string): MovieMedia | undefined {
  const entry = readCache()[id];
  return entry && entry.expires > Date.now() ? entry.media : undefined;
}
function save(id: string, media: MovieMedia) {
  const now = Date.now();
  const ttl = media.poster || Object.keys(media.people).length ? 86400000 : 900000;
  const older = Object.entries(readCache())
    .filter(([otherId, entry]) => otherId !== id && entry.expires > now)
    .slice(0, 99);
  writeStorage(key, Object.fromEntries([[id, { expires: now + ttl, media }], ...older]));
}
export function loadMovieMedia(id: string): Promise<MovieMedia> {
  const cached = cachedMovieMedia(id);
  if (cached) return Promise.resolve(cached);
  const existing = pending.get(id);
  if (existing) return existing;
  // Shared requests outlive individual cards; unmounted subscribers ignore the result.
  const request = fetch(`/api/media/${encodeURIComponent(id)}`, {
    credentials: "same-origin",
    cache: "default",
    signal: AbortSignal.timeout(30000),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Media HTTP ${response.status}`);
      const media = movieMediaSchema.parse(await response.json());
      save(id, media);
      return media;
    })
    .finally(() => pending.delete(id));
  pending.set(id, request);
  return request;
}
