# HTTP API

The application exposes a same-origin JSON API under `/api`. Browser requests include an HttpOnly `cineclue_visitor` cookie. This cookie is the anonymous session credential; keep it private. UUIDs are generated cryptographically on the server.

Session and search responses use `Cache-Control: no-store`. Media metadata uses `Cache-Control: private, max-age=900` in addition to the application caches described in [data and media](DATA.md#images-and-caching).

## Daily

- `GET /daily` creates or resumes the current UTC Daily session. A visitor cookie is issued when needed.
- `POST /daily/guess` submits `{ "movieId": "Q25188" }` and requires `If-Match: "<session UUID>"`. It returns the updated session.

The session ID prevents a tab from submitting yesterday's guess into today's puzzle. A stale header returns `409 daily_expired`.

## Unlimited

- `POST /unlimited` creates a game with `{ "difficulty": "normal", "pack": "popular" }`. Both fields have defaults. Returns 201 and a session.
- `GET /unlimited/{game_id}` resumes an owned session.
- `POST /unlimited/{game_id}/guess` accepts `{ "movieId": "Q25188" }` and returns the updated session.

## Challenges

- `POST /challenges` accepts `{ "movieId": "Q25188" }` and returns 201 with `{ "id": "<UUID>", "path": "/challenge/<UUID>" }`.
- `GET /challenges/{id}` creates or resumes this visitor's session for the challenge.
- `POST /challenges/{id}/guess` submits `{ "movieId": "Q25188" }`.

The link does not encode the film ID. Recipients have separate game progress.

## Hints

`POST /games/{game_id}/hints` accepts a `kind` of `genres`, `actor`, `decade` or `filmography` and returns the updated session. One use unlocks after three misses and another after seven. A winning attempt is not a miss. Unused uses carry over within a game; each kind can be redeemed once.

Closing a chooser does not spend a use. A kind with insufficient source data is unavailable. Filmography excludes the target itself. Redemption is serialized with guesses and other hint requests, and finished or expired games reject new hints.

## Catalog and media

- `GET /movies/search?q=...` returns `{ "movies": [...] }` with up to ten public film references. Queries contain 2–160 characters.
- `GET /packs` returns localized collections, eligible counts by `easy`/`normal`/`hard`, catalog size and data-source identifiers. A collection's `count` is its hard-difficulty target count. Counts describe playable targets rather than all searchable films.
- `GET /media/{movie_id}` returns optional poster/portrait metadata and country ISO codes for a known film. Provider credentials are never included.
- `GET /health` checks database connectivity and reports catalog size.

## Session responses

A session includes `id`, `mode`, `date`, `difficulty`, `maxAttempts`, `status`, `guesses` and `hints`. Daily sessions also include `nextPuzzleAt`. The maximum attempt count is eight. Status is `playing`, `won` or `lost`.

`answer` appears only for a won or lost game. Unfinished responses contain no target ID or complete target record. Public movie references contain only `id`, `title`, `titles`, `originalTitle` and `releaseYear`.

Each guess contains seven comparisons. Numeric values describe the guess, with a direction toward the target. Set `values` and `matches` contain only guessed entities and their actual intersection. Hint state contains `unlocked`, `remaining`, `nextUnlock`, available kind identifiers and redeemed contents in `used`.

The server checks ownership on session reads and mutations. It does not accept client-supplied film attributes, results or attempt counts. Completed games remain readable; additional guesses return 409.

## Request limits and errors

Mutation bodies must be JSON objects no larger than 4096 bytes, without extra keys. Foreign `Origin` and `Sec-Fetch-Site: cross-site` POST requests are rejected. There is no wildcard CORS policy.

The shared database-backed limit allows 60 mutations per remote IP per minute. A rejected request returns `429 rate_limited` and `Retry-After: 60`. GET requests do not consume this quota. See [deployment](DEPLOYMENT.md#proxy-identity-and-request-limits) for proxy identity and edge limits.

Errors use `{ "error": "code" }`:
- **400:** `invalid_input`, `invalid_json`.
- **403:** `invalid_origin`.
- **404:** `not_found`.
- **405:** `method_not_allowed`.
- **409:** `daily_expired`, `already_guessed`, `game_finished`, `hints_locked`, `hint_used`.
- **413:** `body_too_large`.
- **415:** `json_required`.
- **422:** `unknown_movie`, `no_candidates`, `hint_unavailable`.
- **429:** `rate_limited`.
- **500:** `internal_error`.
- **503:** `catalog_unavailable`.

Internal stack traces are logged server-side and are not returned to clients.
