import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { extname, resolve, sep } from "node:path";
import { z } from "zod";
import { hintKinds, type MovieMedia } from "../../../packages/game-engine/src/model.ts";
import type { Catalog } from "./catalog.ts";
import { pool } from "./db.ts";
import { ApiError, Games } from "./game.ts";
import { MediaCatalog } from "./media.ts";

const uuid = z.uuid();
const hintBody = z.object({ kind: z.enum(hintKinds) }).strict();
const guessBody = z.object({ movieId: z.string().min(1).max(120) }).strict();
const unlimitedBody = z
  .object({
    difficulty: z.enum(["easy", "normal", "hard"]).default("normal"),
    pack: z.string().max(80).default("popular"),
  })
  .strict();
async function body(req: IncomingMessage) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new ApiError(415, "json_required");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) throw new ApiError(413, "body_too_large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "invalid_json");
  }
}
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};
export function app(
  catalog: Catalog,
  secret: string,
  options: {
    media?: Record<string, MovieMedia>;
    origin?: string;
    secureCookies?: boolean;
    staticRoot?: string;
    rateLimit?: number;
    trustedProxyIp?: string;
  } = {},
) {
  const games = new Games(catalog, secret);
  const media = new MediaCatalog(catalog, undefined, options.media);
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://image.tmdb.org https://upload.wikimedia.org https://thumb.wikimedia.org; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    const send = (status: number, value: unknown) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url ?? "/", "http://local");
      const path = url.pathname;
      const method = req.method ?? "GET";
      if (!path.startsWith("/api/")) {
        if (method !== "GET" || !options.staticRoot) throw new ApiError(404, "not_found");
        const root = resolve(options.staticRoot);
        let file = resolve(root, `.${decodeURIComponent(path)}`);
        if (file !== root && !file.startsWith(root + sep)) throw new ApiError(404, "not_found");
        try {
          if (!(await stat(file)).isFile()) file = resolve(root, "index.html");
        } catch {
          file = resolve(root, "index.html");
        }
        res.writeHead(200, {
          "Content-Type": mime[extname(file)] ?? "application/octet-stream",
          "Cache-Control": file.includes(`${sep}assets${sep}`)
            ? "public,max-age=31536000,immutable"
            : "no-cache",
        });
        res.end(await readFile(file));
        return;
      }
      if (method === "GET" && path === "/api/health") {
        await pool.query("SELECT 1");
        send(200, { status: "ok", movies: catalog.movies.length });
        return;
      }
      const mediaRoute = path.match(/^\/api\/media\/([^/]+)$/);
      if (method === "GET" && mediaRoute) {
        const result = media.get(decodeURIComponent(mediaRoute[1]));
        if (!result) throw new ApiError(404, "not_found");
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "private,max-age=900",
        });
        res.end(JSON.stringify(await result));
        return;
      }
      if (method !== "GET" && method !== "POST") throw new ApiError(405, "method_not_allowed");
      if (method === "POST") {
        if (req.headers.origin && req.headers.origin !== options.origin)
          throw new ApiError(403, "invalid_origin");
        if (req.headers["sec-fetch-site"] === "cross-site")
          throw new ApiError(403, "invalid_origin");
        const remote = req.socket.remoteAddress ?? "unknown";
        const forwarded = req.headers["x-real-ip"];
        const address =
          options.trustedProxyIp === remote && typeof forwarded === "string" && isIP(forwarded)
            ? forwarded
            : remote;
        const key = `${address}:${Math.floor(Date.now() / 60000)}`;
        const limited = (
          await pool.query(
            "INSERT INTO rate_limit(key,expires_at) VALUES($1,now()+interval '2 minutes') ON CONFLICT(key) DO UPDATE SET hits=rate_limit.hits+1 RETURNING hits",
            [key],
          )
        ).rows[0];
        if (limited.hits > (options.rateLimit ?? 60)) {
          res.setHeader("Retry-After", "60");
          throw new ApiError(429, "rate_limited");
        }
      }
      const cookie = req.headers.cookie
        ?.split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("cineclue_visitor="))
        ?.slice(17);
      const parsed = uuid.safeParse(cookie);
      const visitor = parsed.success ? parsed.data : randomUUID();
      if (!parsed.success)
        res.setHeader(
          "Set-Cookie",
          `cineclue_visitor=${visitor}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${options.secureCookies ? "; Secure" : ""}`,
        );
      if (method === "GET" && path === "/api/daily") {
        send(200, await games.daily(visitor));
        return;
      }
      if (method === "POST" && path === "/api/daily/guess") {
        const b = guessBody.parse(await body(req));
        const game = await games.daily(visitor);
        if (req.headers["if-match"] !== `"${game.id}"`) throw new ApiError(409, "daily_expired");
        send(200, await games.guess(game.id, visitor, b.movieId));
        return;
      }
      const hintRoute = path.match(/^\/api\/games\/([^/]+)\/hints$/);
      if (method === "POST" && hintRoute) {
        const id = uuid.parse(hintRoute[1]);
        const b = hintBody.parse(await body(req));
        send(200, await games.hint(id, visitor, b.kind));
        return;
      }
      if (method === "GET" && path === "/api/movies/search") {
        const q = z
          .string()
          .max(160)
          .parse(url.searchParams.get("q") ?? "");
        send(200, { movies: catalog.search(q) });
        return;
      }
      if (method === "GET" && path === "/api/packs") {
        send(200, {
          packs: catalog.packs.map((p) => ({
            ...p,
            count: catalog.candidates("hard", p.id).length,
            counts: Object.fromEntries(
              (["easy", "normal", "hard"] as const).map((difficulty) => [
                difficulty,
                catalog.candidates(difficulty, p.id).length,
              ]),
            ),
            category:
              p.id === "popular"
                ? "all"
                : p.rules.countryIds
                  ? "country"
                  : p.rules.directorIds
                    ? "director"
                    : p.rules.yearMin || p.rules.yearMax
                      ? "era"
                      : "genre",
          })),
          catalogSize: catalog.movies.length,
          dataSources: catalog.sources,
        });
        return;
      }
      if (method === "POST" && path === "/api/challenges") {
        const b = guessBody.parse(await body(req));
        if (!catalog.byId.has(b.movieId)) throw new ApiError(422, "unknown_movie");
        const { rows } = await pool.query(
          "INSERT INTO challenge(target_id) VALUES($1) RETURNING id",
          [b.movieId],
        );
        send(201, { id: rows[0].id, path: `/challenge/${rows[0].id}` });
        return;
      }
      if (method === "POST" && path === "/api/unlimited") {
        const b = unlimitedBody.parse(await body(req));
        send(201, await games.unlimited(visitor, b.difficulty, b.pack));
        return;
      }
      const challenge = path.match(/^\/api\/challenges\/([^/]+)(\/guess)?$/);
      if (challenge) {
        const id = uuid.parse(challenge[1]);
        if (method === "GET" && !challenge[2]) {
          send(200, await games.challenge(id, visitor));
          return;
        }
        if (method === "POST" && challenge[2]) {
          const b = guessBody.parse(await body(req));
          const game = await games.challenge(id, visitor);
          send(200, await games.guess(game.id, visitor, b.movieId));
          return;
        }
      }
      const unlimited = path.match(/^\/api\/unlimited\/([^/]+)(\/guess)?$/);
      if (unlimited) {
        const id = uuid.parse(unlimited[1]);
        const game = await games.view(id, visitor);
        if (game.mode !== "unlimited") throw new ApiError(404, "not_found");
        if (method === "GET" && !unlimited[2]) {
          send(200, game);
          return;
        }
        if (method === "POST" && unlimited[2]) {
          const b = guessBody.parse(await body(req));
          send(200, await games.guess(id, visitor, b.movieId));
          return;
        }
      }
      throw new ApiError(404, "not_found");
    } catch (error) {
      if (error instanceof z.ZodError) {
        send(400, { error: "invalid_input" });
      } else if (error instanceof ApiError) {
        send(error.status, { error: error.code });
      } else {
        console.error(error);
        send(500, { error: "internal_error" });
      }
    }
  });
}
