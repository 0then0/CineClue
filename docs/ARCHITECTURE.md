# Architecture

CineClue is a TypeScript monorepo with a React/Vite frontend, a Node.js HTTP API and PostgreSQL. On Netlify, the CDN serves the built frontend and a Function handles `/api/*`. The standalone Node server can also serve the frontend. During development, Vite proxies `/api` to the API on port 3001.

## Project layout

```text
apps/api/                 HTTP handlers, PostgreSQL access and migrations
apps/web/                 React interface, translations and browser state
packages/game-engine/     Domain models, comparisons, search and difficulty scoring
data/                     Versioned catalog, source seed, collections and JSON Schema
scripts/import_movies/    Provider adapters, catalog generation and database seeding
scripts/validate_dataset/ Catalog and collection validation
netlify/functions/        HTTP function entry point and scheduled rate-counter cleanup
docker/                   Container image and startup script
docs/                     API, data and deployment guides
```

Node.js runs erasable TypeScript directly. The browser is built with Vite. Zod validates catalog records and API inputs; the game engine has no UI or provider dependency.

## From search to result

Search normalizes case, diacritics, punctuation and `ё/е`. The catalog index contains titles, original titles and aliases, with precomputed trigrams for tolerant matching. Search returns public film references, not hidden puzzle attributes.

A guess submits a movie ID. The server loads the selected catalog record and compares seven fields with the saved target. Numeric clues include a direction; years within three and runtimes within ten minutes are close. Entity sets compare canonical IDs, returning the guessed entities and their intersection with the answer.

The server locks the session row during a guess or hint redemption. Duplicate guesses, finished games and attempts beyond eight are rejected. The response reveals the target only after victory or the eighth miss.

## Game modes

Daily uses a separate pool backed by the versioned TMDB audience snapshot in `data/daily-pool.json`: at least 5,000 votes, complete comparison attributes, three principal actors, at least twelve neighboring films through shared cast/directors and a guessability score of 75. Raw popularity scores from different providers are not used as interchangeable audience counts. Selection excludes films assigned in the preceding 180 UTC dates and, where alternatives exist, directors featured in the preceding seven days. A small exhausted custom pool reuses the least recently assigned eligible film. An HMAC of the UTC date and server secret selects among the remaining candidates. PostgreSQL persists the assignment under a unique date constraint so concurrent visitors receive the same film. Existing assignments are reused before evaluating a new pool, so catalog updates or an empty refreshed pool do not replace an active puzzle. A stale Daily guess is rejected using its `If-Match` session ID.

Unlimited chooses a random eligible target, avoiding the visitor's 20 most recent targets when the collection allows it. The browser route is `/unlimited`; the owned session ID and selected collection are kept in `sessionStorage` for that tab. Returning to the mode or reloading resumes the current game. The New game and Play another film buttons explicitly create a new session. Legacy `/unlimited/{game_id}` links still resume the specified session and are normalized to `/unlimited`. If a saved session no longer exists, a replacement is created; network failures retain the saved session for retry. When session storage is unavailable, navigation can resume the game in memory, but a reload cannot restore its ID. Difficulty combines complete metadata, actor/director connections and a popularity proxy. It is not an audience rating or a guarantee that a film is easy to recognize.

Challenge links contain random UUIDs. Recipients receive separate sessions for the chosen film; the movie ID is not encoded in the link. The challenge creation screen uses `/challenge` and can be opened directly or through browser history. Shared playable challenges keep `/challenge/{challenge_id}`; the builder route does not fetch or create a game until a film is selected.

## Persistence

Movies, aliases, people, genres, countries, studios and collections use normalized PostgreSQL tables. Actors and directors share person identities through role-bearing relationships.

Sessions, Daily assignments, challenges, comparisons and redeemed hints are stored on the server. Target attributes are snapshotted so later catalog corrections preserve ongoing games and the current Daily. The seed command backfills snapshots for older sessions before updating facts.

An HttpOnly cookie identifies an anonymous visitor. The browser stores language, theme, Daily statistics and cached image metadata in localStorage. Cooperating tabs serialize statistics writes with Web Locks where available and merge the latest stored records before writing.

## Runtime boundaries

The API loads and validates the catalog at startup. Netlify initializes it lazily once per warm instance; concurrent first requests share the initialization promise and failed initialization is retried by a later request. The same Fetch handler serves Node and Functions, preserving interactive PostgreSQL transactions. Netlify client identity comes only from `context.ip`. A daily scheduled function removes expired rate counters without loading the catalog; the standalone server retains its minute-based timer. Search and comparison operate on this in-memory catalog; PostgreSQL stores durable game state. Multiple API instances must share the database, catalog and Daily secret. Mutation rate counters are shared through PostgreSQL.

Movie-provider credentials remain server-side. Media lookups are optional, have bounded concurrency and timeouts, and do not prevent gameplay. See [data and media](DATA.md) for caching and attribution, and [deployment](DEPLOYMENT.md) for public hosting.

Genre relationships include both base genres and curated `subgenre:` entities. The catalog loader separates them for the engine. `movie.genre_profile` stores a versioned historical genre snapshot for compatibility with game targets saved before a taxonomy update; it is not used as the current genre relationship source.

## Interface localization

The client supports `en`, `ru`, `es`, `de`, `fr`, `ja` and `pt-BR`. Complete typed message dictionaries cover the interface, help, hints and errors. A language selector persists the choice in localStorage; on first visit, supported browser language preferences are used, with English as the fallback and Portuguese mapped to Brazilian Portuguese. Dates and modern country names use the browser Intl APIs; historical countries retain explicit names. Built-in genre, subgenre and collection labels are translated by stable identity. Movie and person names fall back from the selected locale to its base language, then English and the source title/name. This does not fetch additional provider translations or change the catalog search index.
