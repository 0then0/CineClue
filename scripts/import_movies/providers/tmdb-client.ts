import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Import cache contains public provider responses, never request headers or tokens.
export class TmdbClient {
  private next = 0;
  private token: string;
  private directory: string;
  constructor(token: string, directory: string) {
    this.token = token;
    this.directory = directory;
  }
  async get(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(`https://api.themoviedb.org/3/${path}`);
    url.search = new URLSearchParams(params).toString();
    const file = join(
      this.directory,
      `${createHash("sha256").update(url.href).digest("hex")}.json`,
    );
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch {
      /* Fetch missing cache entries. */
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      const start = Math.max(Date.now(), this.next);
      this.next = start + 100;
      await delay(Math.max(0, start - Date.now()));
      try {
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.token}`,
            "User-Agent": "CineClue/0.1 catalog importer",
          },
          signal: AbortSignal.timeout(20000),
          redirect: "error",
        });
        if (response.status === 429 || response.status >= 500) {
          if (attempt === 5) throw new Error(`TMDB HTTP ${response.status} after retries`);
          const seconds = Number(response.headers.get("Retry-After"));
          const wait =
            Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000 * 2 ** attempt;
          this.next = Math.max(this.next, Date.now() + wait);
          await delay(wait);
          continue;
        }
        if (!response.ok) throw new Error(`TMDB HTTP ${response.status}`);
        const result: unknown = await response.json();
        await mkdir(this.directory, { recursive: true });
        const temporary = `${file}.tmp`;
        await writeFile(temporary, JSON.stringify(result));
        await rename(temporary, file);
        return result;
      } catch (error) {
        if (error instanceof Error && /TMDB HTTP (400|401|403|404)/.test(error.message))
          throw error;
        if (attempt === 5) throw error;
        await delay(1000 * 2 ** attempt);
      }
    }
    throw new Error("TMDB import failed");
  }
}
export async function mapConcurrent<T, R>(
  values: T[],
  work: (value: T, index: number) => Promise<R>,
  concurrency = 6,
) {
  const result = new Array<R>(values.length);
  let next = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (!failed && next < values.length) {
        const index = next++;
        const value = values[index];
        if (value === undefined) continue;
        try {
          result[index] = await work(value, index);
        } catch (error) {
          failed = true;
          failure = error;
        }
      }
    }),
  );
  if (failed) throw failure;
  return result;
}
