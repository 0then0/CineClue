import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mapConcurrent, TmdbClient } from "./tmdb-client.ts";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "cineclue-import-test-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});
it("resumes from cached public responses without saving credentials", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify({ id: 1 })));
  expect(await new TmdbClient("private-token", directory).get("movie/1")).toEqual({ id: 1 });
  expect(await new TmdbClient("different-token", directory).get("movie/1")).toEqual({ id: 1 });
  expect(fetch).toHaveBeenCalledTimes(1);
  const files = await readdir(directory);
  expect(files).toHaveLength(1);
  expect(await readFile(join(directory, files[0] ?? ""), "utf8")).not.toContain("token");
});
it("stops immediately on rejected credentials without caching the error", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("{}", { status: 401 }));
  await expect(new TmdbClient("invalid", directory).get("movie/1")).rejects.toThrow("HTTP 401");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await readdir(directory)).toHaveLength(0);
});
it("bounds concurrent requests and preserves input order", async () => {
  let active = 0;
  let peak = 0;
  const result = await mapConcurrent(
    [1, 2, 3, 4, 5],
    async (value) => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return value * 2;
    },
    2,
  );
  expect(result).toEqual([2, 4, 6, 8, 10]);
  expect(peak).toBe(2);
});
