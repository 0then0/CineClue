import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import netlifyApi from "../../../netlify/functions/api.ts";
import cleanup from "../../../netlify/functions/cleanup.ts";
import { compareMovies, compareSet } from "../../../packages/game-engine/src/index.ts";
import { writeCatalog } from "../../../scripts/import_movies/seed-catalog.ts";
import { Catalog, loadCatalog } from "../src/catalog.ts";
import { selectDaily } from "../src/daily.ts";
import { pool } from "../src/db.ts";
import { Games, utcDate } from "../src/game.ts";
import { app } from "../src/http.ts";

const enabled = process.env.RUN_DB_TESTS === "1";
describe.skipIf(!enabled)("API + disposable PostgreSQL", () => {
  let server: Server;
  let base: string;
  let catalog: Catalog;
  const cookie = () => `cineclue_visitor=${randomUUID()}`;
  async function request(
    path: string,
    visitor: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const r = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie: visitor,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { r, data: await r.json() };
  }
  beforeAll(async () => {
    if (!process.env.DATABASE_URL)
      throw new Error("Explicit DATABASE_URL for a disposable database is required");
    catalog = await loadCatalog();
    server = app(catalog, "test-secret-at-least-32-characters", {
      origin: "http://localhost:5173",
      rateLimit: 1000,
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const a = server.address();
    if (!a || typeof a === "string") throw new Error("No port");
    base = `http://127.0.0.1:${a.port}/api`;
  });
  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  });
  it("plays and restores a challenge through the real Netlify entry point", async () => {
    vi.stubEnv("DAILY_SECRET", "netlify-integration-secret-at-least-32-characters");
    vi.stubEnv("PUBLIC_ORIGIN", "https://cineclue.example");
    const origin = "https://cineclue.example";
    const context = { ip: "192.0.2.90" };
    try {
      const created = await netlifyApi(
        new Request(`${origin}/api/challenges`, {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify({ movieId: catalog.movies[0].id }),
        }),
        context,
      );
      expect(created.status).toBe(201);
      const { id } = await created.json();
      const started = await netlifyApi(new Request(`${origin}/api/challenges/${id}`), context);
      expect(started.status).toBe(200);
      const visitor = started.headers.get("set-cookie")?.split(";")[0];
      expect(visitor).toBeTruthy();
      if (!visitor) throw Error("Missing visitor cookie");
      expect(started.headers.get("set-cookie")).toContain("; Secure");
      const game = await started.json();
      expect(game).not.toHaveProperty("answer");
      const won = await netlifyApi(
        new Request(`${origin}/api/challenges/${id}/guess`, {
          method: "POST",
          headers: { origin, cookie: visitor, "content-type": "application/json" },
          body: JSON.stringify({ movieId: catalog.movies[0].id }),
        }),
        context,
      );
      expect(won.status).toBe(200);
      const result = await won.json();
      expect(result.status).toBe("won");
      expect(result.answer.id).toBe(catalog.movies[0].id);
      const restored = await netlifyApi(
        new Request(`${origin}/api/challenges/${id}`, {
          headers: { cookie: visitor },
        }),
        context,
      );
      expect(await restored.json()).toEqual(result);
      expect(
        (await pool.query("SELECT COUNT(*)::int AS count FROM guess WHERE game_id=$1", [game.id]))
          .rows[0].count,
      ).toBe(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("scheduled cleanup removes expired counters and retains live quotas and games", async () => {
    const prefix = randomUUID();
    await pool.query(
      "INSERT INTO rate_limit(key,expires_at) VALUES($1,now()-interval '1 minute'),($2,now()+interval '1 hour')",
      [`${prefix}:expired`, `${prefix}:live`],
    );
    const before = (await pool.query("SELECT COUNT(*) FROM game_session")).rows[0].count;
    await cleanup();
    const rows = (await pool.query("SELECT key FROM rate_limit WHERE key LIKE $1", [`${prefix}:%`]))
      .rows;
    expect(rows).toEqual([{ key: `${prefix}:live` }]);
    expect((await pool.query("SELECT COUNT(*) FROM game_session")).rows[0].count).toBe(before);
  });
  it("bulk import merges identities, preserves cast order, replaces relations and rolls back atomically", async () => {
    const client = await pool.connect();
    const prefix = `bulk:${randomUUID()}`;
    const person = { id: `${prefix}:person`, name: "First's name", names: { en: "First" } };
    const first = {
      ...catalog.movies[0],
      id: `${prefix}:one`,
      title: "A film's title",
      directors: [person],
      actors: [person, { ...person, id: `${prefix}:actor2` }],
      aliases: ["An alias", "An alias"],
    };
    const last = {
      ...first,
      id: `${prefix}:two`,
      directors: [{ ...person, name: "Last", names: { ru: "Последний" } }],
    };
    try {
      await client.query("BEGIN");
      await writeCatalog(client, [first, last], [], false, () => {});
      expect(
        (await client.query("SELECT title FROM movie WHERE id=$1", [first.id])).rows[0].title,
      ).toBe(first.title);
      // The last occurrence is in last.actors, matching the original row-by-row order.
      expect(
        (await client.query("SELECT name,names FROM person WHERE id=$1", [person.id])).rows[0],
      ).toEqual({ name: person.name, names: { en: "First", ru: "Последний" } });
      expect(
        (
          await client.query(
            "SELECT person_id FROM movie_person WHERE movie_id=$1 AND role='actor' ORDER BY position",
            [first.id],
          )
        ).rows.map((r) => r.person_id),
      ).toEqual(first.actors.map((a) => a.id));
      expect(
        (await client.query("SELECT name FROM alias WHERE movie_id=$1", [first.id])).rows,
      ).toEqual([{ name: "An alias" }]);
      await writeCatalog(
        client,
        [{ ...first, aliases: ["Replacement"], actors: [first.actors[1]] }],
        [],
        false,
        () => {},
      );
      expect(
        (await client.query("SELECT name FROM alias WHERE movie_id=$1", [first.id])).rows,
      ).toEqual([{ name: "Replacement" }]);
      expect(
        (
          await client.query(
            "SELECT person_id FROM movie_person WHERE movie_id=$1 AND role='actor'",
            [first.id],
          )
        ).rows,
      ).toEqual([{ person_id: first.actors[1].id }]);
      const invalid = { ...last, runtime: -1 };
      await expect(writeCatalog(client, [invalid], [], false, () => {})).rejects.toThrow();
      await client.query("ROLLBACK");
      expect((await client.query("SELECT id FROM movie WHERE id=$1", [first.id])).rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
  it("additive bulk import retains existing entity facts and first occurrence for new identities", async () => {
    const client = await pool.connect();
    const prefix = `preserve:${randomUUID()}`;
    const person = { id: `${prefix}:person`, name: "Original", names: { en: "Original" } };
    const first = { ...catalog.movies[0], id: `${prefix}:one`, directors: [person], actors: [] };
    try {
      await client.query("BEGIN");
      await writeCatalog(client, [first], [], true, () => {});
      await writeCatalog(
        client,
        [
          {
            ...first,
            id: `${prefix}:two`,
            directors: [{ ...person, name: "Changed", names: { ru: "Изменён" } }],
          },
        ],
        [],
        true,
        () => {},
      );
      expect(
        (await client.query("SELECT name,names FROM person WHERE id=$1", [person.id])).rows[0],
      ).toEqual({ name: "Original", names: { en: "Original" } });
      const fresh = { ...person, id: `${prefix}:fresh` };
      await writeCatalog(
        client,
        [
          {
            ...first,
            id: `${prefix}:three`,
            directors: [fresh],
            actors: [{ ...fresh, name: "Later" }],
          },
        ],
        [],
        true,
        () => {},
      );
      expect(
        (await client.query("SELECT name FROM person WHERE id=$1", [fresh.id])).rows[0].name,
      ).toBe("Original");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
  it("compares new guesses with legacy genres for a pre-taxonomy game", async () => {
    const target = catalog.byId.get("Q83495");
    const guess = catalog.byId.get("Q189600");
    if (!target?.genreProfile || !guess?.genreProfile)
      throw Error("Expected Matrix genre profiles");
    const visitor = randomUUID();
    const games = new Games(catalog, "test-secret-at-least-32-characters");
    const game = await games.unlimited(visitor, "normal", "popular");
    const legacy = {
      ...target,
      genres: target.genreProfile.legacy,
      genreProfile: undefined,
      subgenres: undefined,
    };
    await pool.query("UPDATE game_session SET target_id=$2,target_snapshot=$3 WHERE id=$1", [
      game.id,
      target.id,
      JSON.stringify(legacy),
    ]);
    const result = await games.guess(game.id, visitor, guess.id);
    expect(result.guesses[0].comparison.genres).toEqual(
      compareSet(guess.genreProfile.legacy, target.genreProfile.legacy),
    );
    expect(result).not.toHaveProperty("answer");
  });
  it("loads normalized subgenres separately and retains legacy genre profiles", () => {
    const films = catalog.movies.filter((m) => m.genreProfile);
    expect(films).toHaveLength(10000);
    expect(films.some((m) => m.subgenres?.length)).toBe(true);
    expect(films.every((m) => m.genres.every((g) => !g.id.startsWith("subgenre:")))).toBe(true);
    expect(films.every((m) => m.genreProfile?.legacy.length)).toBe(true);
  });
  it("matches country aliases against an existing target snapshot without rewriting earlier guesses", async () => {
    const target = catalog.byId.get("tmdb:49106");
    const previous = catalog.byId.get("Q125772");
    const next = catalog.byId.get("Q118976");
    if (!target || !previous || !next) throw Error("Missing Soviet country fixtures");
    const visitor = randomUUID();
    const games = new Games(catalog, "country-regression");
    const challenge = (
      await pool.query("INSERT INTO challenge(target_id) VALUES($1) RETURNING id", [target.id])
    ).rows[0];
    const game = await games.challenge(challenge.id, visitor);
    const before = (
      await pool.query("SELECT target_snapshot FROM game_session WHERE id=$1", [game.id])
    ).rows[0].target_snapshot;
    expect(before.countries[0].id).toBe("iso:SU");
    const legacy = compareMovies(previous, target);
    legacy.countries = { values: previous.countries, matches: [], status: "miss" };
    await pool.query("INSERT INTO guess(game_id,ordinal,movie_id,comparison) VALUES($1,1,$2,$3)", [
      game.id,
      previous.id,
      JSON.stringify(legacy),
    ]);
    const result = await games.guess(game.id, visitor, next.id);
    expect(result.guesses[1].comparison.countries).toMatchObject({
      status: "exact",
      matches: [{ id: "Q15180" }],
      values: [{ id: "Q15180" }],
    });
    expect(result.guesses[0].comparison).toEqual(legacy);
    const after = (
      await pool.query("SELECT target_snapshot FROM game_session WHERE id=$1", [game.id])
    ).rows[0].target_snapshot;
    expect(after).toEqual(before);
    expect(
      (await pool.query("SELECT comparison FROM guess WHERE game_id=$1 AND ordinal=1", [game.id]))
        .rows[0].comparison,
    ).toEqual(legacy);
    const reloaded = await games.view(game.id, visitor);
    expect(reloaded.guesses).toEqual(result.guesses);
  });
  it("matches Netherlands country aliases for a real co-production through the API", async () => {
    const target = catalog.movies.find(
      (m) => m.countries.length === 1 && m.countries[0].id === "iso:NL",
    );
    const guessed = catalog.movies.find((m) => m.countries.some((c) => c.id === "Q55"));
    if (!target || !guessed) throw Error("Missing Netherlands country fixtures");
    const visitor = randomUUID();
    const games = new Games(catalog, "country-regression");
    const challenge = (
      await pool.query("INSERT INTO challenge(target_id) VALUES($1) RETURNING id", [target.id])
    ).rows[0];
    const game = await games.challenge(challenge.id, visitor);
    const result = await games.guess(game.id, visitor, guessed.id);
    expect(result.guesses[0].comparison.countries.status).toBe("partial");
    expect(result.guesses[0].comparison.countries.matches.map((c) => c.id)).toEqual(["Q55"]);
    expect(result).not.toHaveProperty("answer");
  });
  it("rejects unknown media IDs and restricts external image hosts", async () => {
    const { r, data } = await request("/media/unknown-movie", cookie());
    expect(r.status).toBe(404);
    expect(data.error).toBe("not_found");
    const policy = r.headers.get("content-security-policy");
    expect(policy).toContain(
      "img-src 'self' data: https://image.tmdb.org https://upload.wikimedia.org https://thumb.wikimedia.org;",
    );
    expect(policy).not.toContain("img-src *");
    expect(policy).toContain("connect-src 'self'");
  });
  it("lists playable collections with accurate difficulty counts and starts an animated game", async () => {
    const { data } = await request("/packs", cookie());
    expect(data.packs.length).toBeGreaterThan(20);
    expect(data.packs[0].id).toBe("popular");
    for (const p of data.packs) {
      for (const difficulty of ["easy", "normal", "hard"] as const) {
        expect(p.counts[difficulty]).toBe(catalog.candidates(difficulty, p.id).length);
        expect(p.counts[difficulty]).toBeGreaterThan(0);
      }
    }
    const animation = data.packs.find((p: { id: string }) => p.id === "animation");
    expect(animation.counts.normal).toBeGreaterThan(50);
    const player = cookie();
    const result = await request("/unlimited", player, { pack: "animation", difficulty: "normal" });
    expect(result.r.status).toBe(201);
    const stored = await pool.query("SELECT target_id FROM game_session WHERE id=$1", [
      result.data.id,
    ]);
    expect(
      catalog.candidates("normal", "animation").some((m) => m.id === stored.rows[0].target_id),
    ).toBe(true);
  });
  it("persists one popular Daily under concurrent requests and excludes recent films and directors", async () => {
    const date = utcDate();
    const secret = "test-secret-at-least-32-characters";
    const previous = selectDaily(catalog.dailyCandidates(), [], date, secret);
    if (!previous) throw new Error("No Daily pool");
    const yesterday = utcDate(new Date(Date.parse(`${date}T00:00:00Z`) - 86400000));
    await pool.query(
      "INSERT INTO daily_puzzle(puzzle_date,target_id,target_snapshot) VALUES($1,$2,$3)",
      [yesterday, previous.id, JSON.stringify(previous)],
    );
    const games = new Games(catalog, secret);
    const sessions = await Promise.all(Array.from({ length: 6 }, () => games.daily(randomUUID())));
    const stored = (
      await pool.query("SELECT target_id,target_snapshot FROM daily_puzzle WHERE puzzle_date=$1", [
        date,
      ])
    ).rows[0];
    expect(stored.target_id).not.toBe(previous.id);
    expect(catalog.dailyCandidates().some((m) => m.id === stored.target_id)).toBe(true);
    const previousDirectors = new Set(previous.directors.map((d) => d.id));
    expect(
      stored.target_snapshot.directors.some((d: { id: string }) => previousDirectors.has(d.id)),
    ).toBe(false);
    const targets = (
      await pool.query("SELECT DISTINCT target_id FROM game_session WHERE id=ANY($1::uuid[])", [
        sessions.map((s) => s.id),
      ])
    ).rows;
    expect(targets).toEqual([{ target_id: stored.target_id }]);
    // An already assigned day survives a changed or temporarily empty Daily pool.
    const noPool = new Games(new Catalog(catalog.movies, catalog.packs), "changed-secret");
    const resumed = await noPool.daily(randomUUID());
    const assigned = (
      await pool.query("SELECT target_id,target_snapshot FROM game_session WHERE id=$1", [
        resumed.id,
      ])
    ).rows[0];
    expect(assigned).toEqual(stored);
  });
  it("issues an HttpOnly cookie, resumes progress and gives every visitor the same daily target", async () => {
    const fresh = await fetch(`${base}/daily`);
    expect(fresh.headers.get("set-cookie")).toMatch(/HttpOnly; SameSite=Lax/);
    const c1 = cookie(),
      c2 = cookie();
    const first = await request("/daily", c1);
    const second = await request("/daily", c2);
    expect(first.data).not.toHaveProperty("answer");
    expect(JSON.stringify(first.data)).not.toContain("target");
    expect(first.data.id).not.toBe(second.data.id);
    const rows = (
      await pool.query("SELECT DISTINCT target_id FROM game_session WHERE id=ANY($1::uuid[])", [
        [first.data.id, second.data.id],
      ])
    ).rows;
    expect(rows).toHaveLength(1);
    const wrong = catalog.movies.find((m) => m.id !== rows[0].target_id);
    if (!wrong) throw new Error("No wrong guess");
    const guess = await request(
      "/daily/guess",
      c1,
      { movieId: wrong.id },
      { "If-Match": `"${first.data.id}"` },
    );
    expect(guess.r.status).toBe(200);
    expect(guess.data).not.toHaveProperty("answer");
    expect(guess.data.guesses).toHaveLength(1);
    const resumed = await request("/daily", c1);
    expect(resumed.data.guesses).toHaveLength(1);
    expect(resumed.data.date).toBe(utcDate());
    const stale = await request(
      "/daily/guess",
      c1,
      { movieId: wrong.id },
      { "If-Match": `"${randomUUID()}"` },
    );
    expect(stale.r.status).toBe(409);
  });
  it("creates opaque challenges, reveals only on victory and isolates different visitors", async () => {
    const target = catalog.movies[0];
    const creator = cookie(),
      player = cookie();
    const created = await request("/challenges", creator, { movieId: target.id });
    expect(created.r.status).toBe(201);
    expect(created.data.path).not.toContain(target.id);
    const start = await request(`/challenges/${created.data.id}`, player);
    expect(start.data.status).toBe("playing");
    expect(start.data).not.toHaveProperty("answer");
    const won = await request(`/challenges/${created.data.id}/guess`, player, {
      movieId: target.id,
    });
    expect(won.data.status).toBe("won");
    expect(won.data.answer.id).toBe(target.id);
    const later = await request(`/challenges/${created.data.id}/guess`, player, {
      movieId: target.id,
    });
    expect(later.r.status).toBe(409);
    const other = await request(`/challenges/${created.data.id}`, cookie());
    expect(other.data.status).toBe("playing");
    expect(other.data.guesses).toEqual([]);
  });
  it("serializes concurrent moves and reveals after exactly eight misses", async () => {
    const target = catalog.movies[0],
      visitor = cookie();
    const created = await request("/challenges", cookie(), { movieId: target.id });
    const path = `/challenges/${created.data.id}/guess`;
    const wrong = catalog.movies.filter((m) => m.id !== target.id).slice(0, 9);
    const duplicate = await Promise.all([
      request(path, visitor, { movieId: wrong[0].id }),
      request(path, visitor, { movieId: wrong[0].id }),
    ]);
    expect(duplicate.map((r) => r.r.status).sort()).toEqual([200, 409]);
    const rest = await Promise.all(
      wrong.slice(1, 8).map((m) => request(path, visitor, { movieId: m.id })),
    );
    expect(rest.every((r) => r.r.status === 200)).toBe(true);
    const finished = await request(`/challenges/${created.data.id}`, visitor);
    expect(finished.data.status).toBe("lost");
    expect(finished.data.guesses).toHaveLength(8);
    expect(finished.data.answer.id).toBe(target.id);
    const ninth = await request(path, visitor, { movieId: wrong[8].id });
    expect(ninth.r.status).toBe(409);
  });
  it("uses ownership for unlimited, excludes recent targets and accepts difficulty and packs", async () => {
    const visitor = cookie();
    const first = await request("/unlimited", visitor, { difficulty: "easy", pack: "popular" });
    expect(first.r.status).toBe(201);
    expect(first.data).not.toHaveProperty("answer");
    const second = await request("/unlimited", visitor, { difficulty: "hard", pack: "popular" });
    const targets = await pool.query(
      "SELECT target_id FROM game_session WHERE id=ANY($1::uuid[])",
      [[first.data.id, second.data.id]],
    );
    expect(new Set(targets.rows.map((r) => r.target_id)).size).toBe(2);
    expect((await request(`/unlimited/${first.data.id}`, cookie())).r.status).toBe(404);
    expect((await request(`/unlimited/${first.data.id}`, visitor)).r.status).toBe(200);
    expect((await request("/unlimited", visitor, { pack: "unknown" })).r.status).toBe(422);
  });
  it("rejects invalid input, forged attributes, cross-origin mutations and unknown routes", async () => {
    const c = cookie();
    expect((await request("/challenges", c, { movieId: "x", targetId: "forged" })).r.status).toBe(
      400,
    );
    expect((await request("/challenges", c, { movieId: "not-in-catalog" })).r.status).toBe(422);
    expect((await request("/challenges/not-a-uuid", c)).r.status).toBe(400);
    expect((await request("/unlimited", c, {}, { Origin: "https://evil.example" })).r.status).toBe(
      403,
    );
    expect((await request("/missing", c)).r.status).toBe(404);
  });
  it("searches localized titles without returning hidden attributes", async () => {
    const m = catalog.movies.find((m) => m.titles.ru && m.titles.ru.length > 4);
    if (!m) throw new Error("Missing Russian fixture");
    const result = await request(`/movies/search?q=${encodeURIComponent(m.titles.ru)}`, cookie());
    expect(result.data.movies.map((m: { id: string }) => m.id)).toContain(m.id);
    expect(result.data.movies[0]).not.toHaveProperty("actors");
    expect((await request(`/movies/search?q=${"x".repeat(161)}`, cookie())).r.status).toBe(400);
  });
  it("rejects yesterday sessions inside the engine", async () => {
    const visitor = randomUUID();
    const date = "2000-01-01";
    const target = catalog.movies[0];
    const puzzle = (
      await pool.query(
        "INSERT INTO daily_puzzle(puzzle_date,target_id) VALUES($1,$2) ON CONFLICT(puzzle_date) DO UPDATE SET target_id=EXCLUDED.target_id RETURNING id",
        [date, target.id],
      )
    ).rows[0];
    const session = (
      await pool.query(
        "INSERT INTO game_session(visitor_id,mode,puzzle_id,target_id) VALUES($1,'daily',$2,$3) RETURNING id",
        [visitor, puzzle.id, target.id],
      )
    ).rows[0];
    await expect(
      new Games(catalog, "secret").guess(session.id, visitor, target.id),
    ).rejects.toMatchObject({ status: 409, code: "daily_expired" });
    await expect(
      new Games(catalog, "secret").hint(session.id, visitor, "actor"),
    ).rejects.toMatchObject({ status: 409, code: "daily_expired" });
  });
  it("unlocks hints after three and seven misses, serializes spending and persists only chosen clues", async () => {
    const target = catalog.movies[0],
      player = cookie();
    const created = await request("/challenges", cookie(), { movieId: target.id });
    const endpoint = `/challenges/${created.data.id}`;
    const start = await request(endpoint, player);
    const id = start.data.id;
    expect(start.data.hints).toMatchObject({ unlocked: 0, remaining: 0, used: [] });
    expect((await request(`/games/${id}/hints`, player, { kind: "actor" })).data.error).toBe(
      "hints_locked",
    );
    expect((await request(`/games/${id}/hints`, cookie(), { kind: "actor" })).r.status).toBe(404);
    expect((await request(`/games/${id}/hints`, player, { kind: "answer" })).r.status).toBe(400);
    const wrong = catalog.movies.filter((m) => m.id !== target.id).slice(0, 8);
    for (const m of wrong.slice(0, 2))
      await request(`${endpoint}/guess`, player, { movieId: m.id });
    expect((await request(`/games/${id}/hints`, player, { kind: "decade" })).r.status).toBe(409);
    const third = await request(`${endpoint}/guess`, player, { movieId: wrong[2].id });
    expect(third.data.hints).toMatchObject({ unlocked: 1, remaining: 1, used: [] });
    expect(third.data).not.toHaveProperty("answer");
    const competing = await Promise.all(
      ["actor", "decade"].map((kind) => request(`/games/${id}/hints`, player, { kind })),
    );
    expect(competing.map((r) => r.r.status).sort()).toEqual([200, 409]);
    const first = (await request(endpoint, player)).data;
    expect(first.hints.used).toHaveLength(1);
    expect(first.hints.remaining).toBe(0);
    expect(first).not.toHaveProperty("answer");
    for (const m of wrong.slice(3, 7))
      await request(`${endpoint}/guess`, player, { movieId: m.id });
    const seventh = (await request(endpoint, player)).data;
    expect(seventh.hints).toMatchObject({ unlocked: 2, remaining: 1 });
    const second = await request(`/games/${id}/hints`, player, { kind: "genres" });
    expect(second.r.status).toBe(200);
    expect(second.data.hints.used).toHaveLength(2);
    expect(second.data.hints.remaining).toBe(0);
    expect(second.data).not.toHaveProperty("answer");
    expect((await request(`/games/${id}/hints`, player, { kind: "genres" })).data.error).toBe(
      "hint_used",
    );
    expect((await request(endpoint, player)).data.hints.used).toEqual(second.data.hints.used);
    await request(`${endpoint}/guess`, player, { movieId: wrong[7].id });
    expect((await request(`/games/${id}/hints`, player, { kind: "decade" })).data.error).toBe(
      "game_finished",
    );
  });
  it("carries an unused hint to seven misses and excludes the answer from director filmography", async () => {
    const target = catalog.movies.find((m) =>
      catalog.movies.some(
        (other) =>
          other.id !== m.id && other.directors.some((p) => m.directors.some((d) => d.id === p.id)),
      ),
    );
    if (!target) throw new Error("No connected director fixture");
    const player = cookie();
    const created = await request("/challenges", cookie(), { movieId: target.id });
    const endpoint = `/challenges/${created.data.id}`;
    const start = await request(endpoint, player);
    const id = start.data.id;
    for (const m of catalog.movies.filter((m) => m.id !== target.id).slice(0, 7))
      await request(`${endpoint}/guess`, player, { movieId: m.id });
    expect((await request(endpoint, player)).data.hints.remaining).toBe(2);
    const filmography = await request(`/games/${id}/hints`, player, { kind: "filmography" });
    expect(filmography.r.status).toBe(200);
    expect(
      filmography.data.hints.used[0].movies.every((m: { id: string }) => m.id !== target.id),
    ).toBe(true);
    const final = await request(`/games/${id}/hints`, player, { kind: "decade" });
    expect(final.data.hints.remaining).toBe(0);
    expect(final.data.hints.used).toHaveLength(2);
    expect((await request(`/games/${id}/hints`, player, { kind: "actor" })).r.status).toBe(409);
  });
  it.each(["daily", "unlimited"] as const)(
    "supports persistent hints in %s games",
    async (mode) => {
      const player = cookie();
      const start =
        mode === "daily"
          ? await request("/daily", player)
          : await request("/unlimited", player, {});
      const target = (
        await pool.query("SELECT target_id FROM game_session WHERE id=$1", [start.data.id])
      ).rows[0].target_id;
      const endpoint = mode === "daily" ? "/daily" : `/unlimited/${start.data.id}`;
      for (const m of catalog.movies.filter((m) => m.id !== target).slice(0, 3))
        await request(
          `${endpoint}/guess`,
          player,
          { movieId: m.id },
          { "If-Match": `"${start.data.id}"` },
        );
      const result = await request(`/games/${start.data.id}/hints`, player, { kind: "actor" });
      expect(result.r.status).toBe(200);
      expect(result.data).not.toHaveProperty("answer");
      expect(result.data.hints.used).toHaveLength(1);
      expect((await request(endpoint, player)).data.hints.used).toEqual(result.data.hints.used);
    },
  );
  it("does not unlock a third-attempt hint on victory after two misses", async () => {
    const target = catalog.movies[0],
      player = cookie();
    const created = await request("/challenges", cookie(), { movieId: target.id });
    const endpoint = `/challenges/${created.data.id}`;
    for (const m of catalog.movies.filter((m) => m.id !== target.id).slice(0, 2))
      await request(`${endpoint}/guess`, player, { movieId: m.id });
    const won = await request(`${endpoint}/guess`, player, { movieId: target.id });
    expect(won.data.status).toBe("won");
    expect(won.data.hints).toMatchObject({ unlocked: 0, remaining: 0, used: [] });
  });
  it("keeps existing game and Daily targets stable across catalog corrections", async () => {
    const player = randomUUID();
    const games = new Games(catalog, "test-secret-at-least-32-characters");
    const game = await games.unlimited(player, "normal", "popular");
    const stored = (
      await pool.query("SELECT target_id,target_snapshot FROM game_session WHERE id=$1", [game.id])
    ).rows[0];
    const target = catalog.byId.get(stored.target_id);
    if (!target) throw new Error("Missing target");
    const corrected = new Catalog(
      catalog.movies.map((m) =>
        m.id === target.id
          ? { ...m, actors: [{ id: "corrected-actor", name: "New credit", names: {} }] }
          : m,
      ),
      catalog.packs,
    );
    const after = new Games(corrected, "test-secret-at-least-32-characters");
    const won = await after.guess(game.id, player, target.id);
    expect(won.answer?.actors).toEqual(target.actors);
    expect(won.guesses[0].comparison.actors.status).toBe("exact");
    const oldDaily = await games.daily(player);
    const dailyRow = (
      await pool.query("SELECT target_id FROM game_session WHERE id=$1", [oldDaily.id])
    ).rows[0];
    const altered = new Catalog(
      catalog.movies.map((m) =>
        m.id === dailyRow.target_id ? { ...m, runtime: m.runtime + 50 } : m,
      ),
      catalog.packs,
    );
    const freshPlayer = randomUUID();
    const newDaily = await new Games(altered, "test-secret-at-least-32-characters").daily(
      freshPlayer,
    );
    const result = await new Games(altered, "test-secret-at-least-32-characters").guess(
      newDaily.id,
      freshPlayer,
      dailyRow.target_id,
    );
    expect(result.answer?.runtime).toBe(catalog.byId.get(dailyRow.target_id)?.runtime);
  });
  it("backfills legacy targets before the correcting seed and keeps recorded clues", async () => {
    const target = catalog.movies[0];
    await pool.query("UPDATE movie SET runtime=runtime+5 WHERE id=$1", [target.id]);
    const legacyCatalog = await loadCatalog();
    const visitor = randomUUID();
    const challenge = (
      await pool.query("INSERT INTO challenge(target_id) VALUES($1) RETURNING id", [target.id])
    ).rows[0];
    const legacyGames = new Games(legacyCatalog, "secret");
    const game = await legacyGames.challenge(challenge.id, visitor);
    await pool.query("UPDATE game_session SET target_snapshot=NULL WHERE id=$1", [game.id]);
    const wrong = legacyCatalog.movies.find((m) => m.id !== target.id);
    if (!wrong) throw new Error("No wrong film");
    const before = await legacyGames.guess(game.id, visitor, wrong.id);
    const run = promisify(execFile);
    await run(process.execPath, ["scripts/import_movies/seed.ts"], {
      env: process.env,
      maxBuffer: 1024 * 1024,
    });
    const updated = await loadCatalog();
    expect(updated.byId.get(target.id)?.runtime).toBe(target.runtime);
    const won = await new Games(updated, "secret").guess(game.id, visitor, target.id);
    expect(won.answer?.runtime).toBe(target.runtime + 5);
    expect(won.guesses[0]).toEqual(before.guesses[0]);
    expect(won.guesses[1].comparison.runtime.status).toBe("exact");
  }, 600000);
  it("rate limits public mutations in PostgreSQL", async () => {
    const limited = app(catalog, "secret", { rateLimit: 0 });
    limited.listen(0, "127.0.0.1");
    await once(limited, "listening");
    const a = limited.address();
    if (!a || typeof a === "string") throw new Error("No port");
    try {
      const r = await fetch(`http://127.0.0.1:${a.port}/api/unlimited`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(r.status).toBe(429);
      expect(r.headers.get("retry-after")).toBe("60");
    } finally {
      await new Promise<void>((resolve) => limited.close(() => resolve()));
    }
  });
});
