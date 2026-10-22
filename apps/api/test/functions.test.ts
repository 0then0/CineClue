import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import cleanup from "../../../netlify/functions/cleanup.ts";
import type { Movie } from "../../../packages/game-engine/src/model.ts";
import { Catalog } from "../src/catalog.ts";
import { pool } from "../src/db.ts";
import { createHandler } from "../src/http.ts";
import { initializeFunction, lazyFunction } from "../src/runtime.ts";

const movie: Movie = JSON.parse(readFileSync("data/catalog.json", "utf8")).movies[0];
const catalog = new Catalog([movie], []);
const origin = "https://cineclue.example";
const secret = "function-test-secret-at-least-32-characters";
const post = (body = JSON.stringify({ movieId: movie.id }), headers = {}) =>
  new Request(`${origin}/api/challenges`, {
    method: "POST",
    body,
    headers: { "content-type": "application/json", origin, ...headers },
  });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("preserves search responses, secure visitor cookies and no-store through the Fetch handler", async () => {
  const query = vi.spyOn(pool, "query");
  const handle = createHandler(catalog, secret, { origin, secureCookies: true });
  const response = await handle(
    new Request(`${origin}/api/movies/search?q=${encodeURIComponent(movie.title)}`),
    "192.0.2.1",
  );
  expect(response.status).toBe(200);
  expect((await response.json()).movies[0].id).toBe(movie.id);
  expect(response.headers.get("set-cookie")).toContain(
    "HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000; Secure",
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  expect(query).not.toHaveBeenCalled();
});

it("uses platform IP, ignores spoofed forwarding headers and gives independent visitor quotas", async () => {
  const hits = new Map<string, number>();
  const query = vi.spyOn(pool, "query").mockImplementation(async (sql, values) => {
    if (String(sql).startsWith("INSERT INTO rate_limit")) {
      const key = (values as string[])[0];
      hits.set(key, (hits.get(key) ?? 0) + 1);
      return { rows: [{ hits: hits.get(key) }] } as never;
    }
    return { rows: [{ id: "challenge-id" }] } as never;
  });
  const handle = createHandler(catalog, secret, { origin, rateLimit: 1 });
  const forged = { "x-real-ip": "198.51.100.7", "x-forwarded-for": "198.51.100.8" };
  expect((await handle(post(undefined, forged), "192.0.2.1")).status).toBe(201);
  const limited = await handle(post(undefined, forged), "192.0.2.1");
  expect(limited.status).toBe(429);
  expect(limited.headers.get("retry-after")).toBe("60");
  expect((await handle(post(undefined, forged), "192.0.2.2")).status).toBe(201);
  expect([...hits.keys()].every((key) => key.startsWith("192.0.2."))).toBe(true);
  query.mockClear();
  expect((await handle(post(undefined, forged), "")).status).toBe(503);
  expect(query).not.toHaveBeenCalled();
});

it("keeps origin and streaming body checks on the function transport", async () => {
  const query = vi.spyOn(pool, "query").mockResolvedValue({ rows: [{ hits: 1 }] } as never);
  const handle = createHandler(catalog, secret, { origin });
  expect((await handle(post("{}", { origin: "https://other.example" }), "192.0.2.1")).status).toBe(
    403,
  );
  expect(query).not.toHaveBeenCalled();
  expect((await handle(post("invalid"), "192.0.2.1")).status).toBe(400);
  expect((await handle(post("x".repeat(4097)), "192.0.2.1")).status).toBe(413);
  expect((await handle(post("{}", { "content-type": "text/plain" }), "192.0.2.1")).status).toBe(
    415,
  );
});

it("shares concurrent initialization and reuses it across warm requests", async () => {
  const handle = vi.fn(async () => new Response("ok"));
  let ready!: (value: typeof handle) => void;
  const initialize = vi.fn(
    () =>
      new Promise<typeof handle>((resolve) => {
        ready = resolve;
      }),
  );
  const handler = lazyFunction(initialize);
  const req = new Request(`${origin}/api/health`);
  const a = handler(req, { ip: "192.0.2.1" });
  const b = handler(req, { ip: "192.0.2.2" });
  expect(initialize).toHaveBeenCalledTimes(1);
  ready(handle);
  expect((await a).status).toBe(200);
  expect((await b).status).toBe(200);
  await handler(req, { ip: "192.0.2.3" });
  expect(initialize).toHaveBeenCalledTimes(1);
  expect(handle.mock.calls).toHaveLength(3);
});

it("retries failed cold initialization without leaking errors to clients", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const initialize = vi
    .fn()
    .mockRejectedValueOnce(new Error("private database details"))
    .mockResolvedValue(async () => new Response("ok"));
  const handler = lazyFunction(initialize);
  const failed = await handler(new Request(`${origin}/api/health`), { ip: "192.0.2.1" });
  expect(failed.status).toBe(500);
  expect(await failed.json()).toEqual({ error: "internal_error" });
  expect(failed.headers.get("cache-control")).toBe("no-store");
  expect((await handler(new Request(`${origin}/api/health`), { ip: "192.0.2.1" })).status).toBe(
    200,
  );
  expect(initialize).toHaveBeenCalledTimes(2);
});

it("rejects incomplete production configuration before loading the catalog", async () => {
  vi.stubEnv("DAILY_SECRET", "");
  await expect(initializeFunction()).rejects.toThrow("DAILY_SECRET");
  vi.stubEnv("DAILY_SECRET", secret);
  vi.stubEnv("DATABASE_URL", "");
  await expect(initializeFunction()).rejects.toThrow("DATABASE_URL");
  vi.stubEnv("DATABASE_URL", "postgres://test");
  for (const value of [
    "http://cineclue.example",
    "https://cineclue.example/",
    "https://cineclue.example/path",
  ]) {
    vi.stubEnv("PUBLIC_ORIGIN", value);
    await expect(initializeFunction()).rejects.toThrow("PUBLIC_ORIGIN");
  }
});

it("runs scheduled cleanup without loading the game catalog or deleting game progress", async () => {
  vi.stubEnv("DATABASE_URL", "postgres://test");
  vi.spyOn(console, "log").mockImplementation(() => {});
  const query = vi.spyOn(pool, "query").mockResolvedValue({ rowCount: 2 } as never);
  await cleanup();
  expect(query).toHaveBeenCalledExactlyOnceWith("DELETE FROM rate_limit WHERE expires_at<now()");
});
