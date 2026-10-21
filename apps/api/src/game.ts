import { createHmac, randomInt } from "node:crypto";
import type { PoolClient } from "pg";
import { createHint, hintAllowance } from "../../../packages/game-engine/src/hints.ts";
import {
  compareMovies,
  type Difficulty,
  type GameHint,
  type GameView,
  type GuessView,
  type HintKind,
  hintKinds,
  movieSchema,
  publicMovie,
} from "../../../packages/game-engine/src/index.ts";
import type { Catalog } from "./catalog.ts";
import { pool } from "./db.ts";
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
export const utcDate = (date = new Date()) => date.toISOString().slice(0, 10);
export const nextMidnight = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString();
export function dailyIndex(date: string, secret: string, count: number) {
  return Number(
    BigInt(`0x${createHmac("sha256", secret).update(`cineclue:v1:${date}`).digest("hex")}`) %
      BigInt(count),
  );
}
export class Games {
  readonly catalog: Catalog;
  readonly secret: string;
  constructor(catalog: Catalog, secret: string) {
    this.catalog = catalog;
    this.secret = secret;
  }
  async daily(visitor: string): Promise<GameView> {
    const date = utcDate();
    const candidates = this.catalog.candidates("normal");
    if (!candidates.length) throw new ApiError(503, "no_candidates");
    const target = candidates[dailyIndex(date, this.secret, candidates.length)];
    await pool.query(
      "INSERT INTO daily_puzzle(puzzle_date,target_id,target_snapshot) VALUES($1,$2,$3) ON CONFLICT(puzzle_date) DO NOTHING",
      [date, target.id, JSON.stringify(target)],
    );
    const puzzle = (
      await pool.query(
        "SELECT id,target_id,target_snapshot FROM daily_puzzle WHERE puzzle_date=$1",
        [date],
      )
    ).rows[0];
    await pool.query(
      "INSERT INTO game_session(visitor_id,mode,puzzle_id,target_id,target_snapshot) VALUES($1,'daily',$2,$3,$4) ON CONFLICT(visitor_id,puzzle_id) DO NOTHING",
      [
        visitor,
        puzzle.id,
        puzzle.target_id,
        JSON.stringify(puzzle.target_snapshot ?? this.catalog.byId.get(puzzle.target_id)),
      ],
    );
    const game = (
      await pool.query("SELECT id FROM game_session WHERE visitor_id=$1 AND puzzle_id=$2", [
        visitor,
        puzzle.id,
      ])
    ).rows[0];
    return this.view(game.id, visitor);
  }
  async unlimited(visitor: string, difficulty: Difficulty, pack: string) {
    const recent = (
      await pool.query(
        "SELECT target_id FROM game_session WHERE visitor_id=$1 AND mode='unlimited' ORDER BY created_at DESC LIMIT 20",
        [visitor],
      )
    ).rows.map((r) => r.target_id as string);
    const all = this.catalog.candidates(difficulty, pack);
    if (!all.length) throw new ApiError(422, "no_candidates");
    let available = all.filter((m) => !recent.includes(m.id));
    if (!available.length) {
      const last = recent[0];
      available = all.filter((m) => m.id !== last);
      if (!available.length) available = all;
    }
    const target = available[randomInt(available.length)];
    const { rows } = await pool.query(
      "INSERT INTO game_session(visitor_id,mode,target_id,difficulty,target_snapshot) VALUES($1,'unlimited',$2,$3,$4) RETURNING id",
      [visitor, target.id, difficulty, JSON.stringify(target)],
    );
    return this.view(rows[0].id, visitor);
  }
  async challenge(id: string, visitor: string) {
    const ch = (await pool.query("SELECT target_id FROM challenge WHERE id=$1", [id])).rows[0];
    if (!ch) throw new ApiError(404, "not_found");
    await pool.query(
      "INSERT INTO game_session(visitor_id,mode,challenge_id,target_id,target_snapshot) VALUES($1,'challenge',$2,$3,$4) ON CONFLICT(visitor_id,challenge_id) DO NOTHING",
      [visitor, id, ch.target_id, JSON.stringify(this.catalog.byId.get(ch.target_id))],
    );
    const { rows } = await pool.query(
      "SELECT id FROM game_session WHERE visitor_id=$1 AND challenge_id=$2",
      [visitor, id],
    );
    return this.view(rows[0].id, visitor);
  }
  async view(
    id: string,
    visitor: string,
    client: PoolClient | typeof pool = pool,
  ): Promise<GameView> {
    const { rows } = await client.query(
      "SELECT s.*,to_char(p.puzzle_date,'YYYY-MM-DD') date FROM game_session s LEFT JOIN daily_puzzle p ON p.id=s.puzzle_id WHERE s.id=$1 AND s.visitor_id=$2",
      [id, visitor],
    );
    const s = rows[0];
    if (!s) throw new ApiError(404, "not_found");
    const guesses: GuessView[] = (
      await client.query(
        "SELECT movie_id,comparison FROM guess WHERE game_id=$1 ORDER BY ordinal",
        [id],
      )
    ).rows.map((g) => {
      const m = this.catalog.byId.get(g.movie_id);
      if (!m) throw new Error("Catalog missing guess");
      return { movie: publicMovie(m), comparison: g.comparison };
    });
    const target = s.target_snapshot
      ? movieSchema.parse(s.target_snapshot)
      : this.catalog.byId.get(s.target_id);
    if (!target) throw new ApiError(503, "catalog_unavailable");
    const used: GameHint[] = (
      await client.query("SELECT content FROM game_hint WHERE game_id=$1 ORDER BY ordinal", [id])
    ).rows.map((r) => r.content);
    const misses = guesses.length - (s.status === "won" ? 1 : 0);
    const unlocked = hintAllowance(misses);
    const options = hintKinds.filter(
      (kind) =>
        !used.some((h) => h.kind === kind) &&
        createHint(kind, target, this.catalog.movies, guesses) !== null,
    );
    return {
      hints: {
        unlocked,
        remaining: s.status === "playing" ? Math.max(0, unlocked - used.length) : 0,
        nextUnlock: misses < 3 ? 3 : misses < 7 ? 7 : null,
        options,
        used,
      },
      id: s.id,
      mode: s.mode,
      date: s.date,
      maxAttempts: 8,
      status: s.status,
      guesses,
      difficulty: s.difficulty,
      ...(s.date ? { nextPuzzleAt: nextMidnight(s.date) } : {}),
      ...(s.status !== "playing" ? { answer: target } : {}),
    };
  }
  async hint(id: string, visitor: string, kind: HintKind): Promise<GameView> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const s = (
        await client.query(
          "SELECT s.*,to_char(p.puzzle_date,'YYYY-MM-DD') date FROM game_session s LEFT JOIN daily_puzzle p ON p.id=s.puzzle_id WHERE s.id=$1 AND s.visitor_id=$2 FOR UPDATE OF s",
          [id, visitor],
        )
      ).rows[0];
      if (!s) throw new ApiError(404, "not_found");
      if (s.status !== "playing") throw new ApiError(409, "game_finished");
      if (s.mode === "daily" && s.date !== utcDate()) throw new ApiError(409, "daily_expired");
      const view = await this.view(id, visitor, client);
      if (view.hints.used.some((h) => h.kind === kind)) throw new ApiError(409, "hint_used");
      if (view.hints.remaining === 0) throw new ApiError(409, "hints_locked");
      const target = s.target_snapshot
        ? movieSchema.parse(s.target_snapshot)
        : this.catalog.byId.get(s.target_id);
      if (!target) throw new ApiError(503, "catalog_unavailable");
      const content = createHint(kind, target, this.catalog.movies, view.guesses);
      if (!content) throw new ApiError(422, "hint_unavailable");
      await client.query(
        "INSERT INTO game_hint(game_id,ordinal,kind,content) VALUES($1,$2,$3,$4)",
        [id, view.hints.used.length + 1, kind, content],
      );
      const updated = await this.view(id, visitor, client);
      await client.query("COMMIT");
      return updated;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async guess(id: string, visitor: string, movieId: string) {
    const movie = this.catalog.byId.get(movieId);
    if (!movie) throw new ApiError(422, "unknown_movie");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const s = (
        await client.query(
          "SELECT s.*,to_char(p.puzzle_date,'YYYY-MM-DD') date FROM game_session s LEFT JOIN daily_puzzle p ON p.id=s.puzzle_id WHERE s.id=$1 AND s.visitor_id=$2 FOR UPDATE OF s",
          [id, visitor],
        )
      ).rows[0];
      if (!s) throw new ApiError(404, "not_found");
      if (s.status !== "playing") throw new ApiError(409, "game_finished");
      if (s.mode === "daily" && s.date !== utcDate()) throw new ApiError(409, "daily_expired");
      const previous = (await client.query("SELECT movie_id FROM guess WHERE game_id=$1", [id]))
        .rows;
      if (previous.some((g) => g.movie_id === movieId)) throw new ApiError(409, "already_guessed");
      const target = s.target_snapshot
        ? movieSchema.parse(s.target_snapshot)
        : this.catalog.byId.get(s.target_id);
      if (!target) throw new ApiError(503, "catalog_unavailable");
      const ordinal = previous.length + 1;
      if (ordinal > 8) throw new ApiError(409, "game_finished");
      await client.query(
        "INSERT INTO guess(game_id,ordinal,movie_id,comparison) VALUES($1,$2,$3,$4)",
        [id, ordinal, movieId, compareMovies(movie.id === target.id ? target : movie, target)],
      );
      const status = movieId === s.target_id ? "won" : ordinal === 8 ? "lost" : "playing";
      await client.query("UPDATE game_session SET status=$1 WHERE id=$2", [status, id]);
      const view = await this.view(id, visitor, client);
      await client.query("COMMIT");
      return view;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
