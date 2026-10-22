import { readFileSync } from "node:fs";
import type { PoolClient } from "pg";
import { expect, it, vi } from "vitest";
import type { Movie } from "../../packages/game-engine/src/model.ts";
import { writeCatalog } from "./seed-catalog.ts";

it("bounds database round trips by batches rather than individual films and entities", async () => {
  const movie: Movie = JSON.parse(readFileSync("data/catalog.json", "utf8")).movies[0];
  const movies = Array.from({ length: 2001 }, (_, i) => ({
    ...movie,
    id: `batch:${i}`,
    title: "A film's title; DROP TABLE movie; --",
  }));
  const query = vi.fn().mockResolvedValue({ rows: [] });
  await writeCatalog({ query } as unknown as PoolClient, movies, [], false, () => {});
  expect(query.mock.calls.length).toBeLessThan(150);
  for (const [sql, params] of query.mock.calls) {
    expect(sql).not.toContain("DROP TABLE");
    if (sql.includes("jsonb_to_recordset"))
      expect(JSON.parse(params[0]).length).toBeLessThanOrEqual(1000);
    else expect(params[0].length).toBeLessThanOrEqual(1000);
  }
});
