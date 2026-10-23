<p align="center"><img src="apps/web/public/icon.svg" alt="CineClue" width="88" height="88"></p>

<h1 align="center">CineClue</h1>
<p align="center">A daily film deduction game.</p>

<p align="center">
  <a href="https://github.com/0then0/CineClue/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/0then0/CineClue/ci.yml?branch=main&label=CI" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License: Apache-2.0"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/TypeScript-7.0.2-3178C6?logo=typescript&logoColor=white" alt="TypeScript 7.0.2"></a>
  <a href="apps/web/package.json"><img src="https://img.shields.io/badge/React-19.3.1-149ECA?logo=react&logoColor=white" alt="React 19.3.1"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/Node.js-24.x-339933?logo=nodedotjs&logoColor=white" alt="Node.js 24.x"></a>
  <a href="pnpm-lock.yaml"><img src="https://img.shields.io/badge/pnpm-12.14.0-F69220?logo=pnpm&logoColor=white" alt="pnpm 12.14.0"></a>
  <a href="docs/DEPLOYMENT.md"><img src="https://img.shields.io/badge/PostgreSQL-16%E2%80%9318-4169E1?logo=postgresql&logoColor=white" alt="PostgreSQL 16–18"></a>
</p>

<p align="center"><strong>English</strong> · <a href="README.ru.md">Русский</a></p>

Guess a mystery film through its connections to other movies. Each attempt compares the release year, director, genres, cast, runtime, countries and studios. Everyone gets the same Daily puzzle, with eight attempts to solve it.

![CineClue in English: film comparisons with posters, cast portraits, studio logos and match indicators](docs/screenshot.jpg)

## Features

- **Daily:** one shared puzzle, resetting at 00:00 UTC, with saved progress and browser statistics.
- **Languages:** English, Russian, Spanish, German, French, Japanese and Brazilian Portuguese. The interface and built-in genre/collection labels are translated; film titles and personal names use the translations available in the catalog.
- **Unlimited:** random puzzles with three difficulty levels and 42 film collections.
- **Challenge:** choose a film and send a shareable puzzle link to a friend.
- **10,000 films:** the catalog is included, so setup does not require a movie API key.
- **Useful clues:** directional arrows, highlighted matches, portraits, posters and country flags.
- **Hints:** unlock a clue after three misses and another after seven.
- **English and Russian**, keyboard search, mobile layouts, and light, dark or system themes.
- **Spoiler-free sharing** through the system share menu or clipboard.

## Run with Docker

Install [Docker Compose](https://docs.docker.com/compose/install/), clone the repository and start the application:

```sh
git clone https://github.com/0then0/CineClue.git
cd CineClue
docker compose up --build
```

Open [localhost:5173](http://localhost:5173). The first start creates the database, applies migrations and imports the included catalog. Allow a few minutes for the initial import. PostgreSQL data persists between restarts.

This Compose configuration is for local development. See [deployment](docs/DEPLOYMENT.md) for public hosting, backups and upgrades.

## How to play

Search for a film by its English, Russian, original or alternative title and select a result. The latest attempt appears first.
- **Exact:** the number or complete set of entities matches.
- **Partial:** some people, genres, countries or studios overlap. Matching entities are highlighted.
- **Close:** within three years or ten minutes of the answer.
- **Arrows:** the answer is newer/longer or older/shorter than your guess.
- **No match:** no shared entities, or a number outside the close range.

After three and seven unsuccessful attempts, choose an available hint: genres, a cast member, the release decade or another film by the director. Closing the chooser does not spend a hint. The answer is revealed when you win or use all eight attempts.

Daily progress is stored on the server and linked to an anonymous browser cookie. Statistics are stored in that browser's localStorage. Clearing cookies removes access to existing games; clearing localStorage removes local statistics. No account is required.

## Develop locally

Use **Node.js 24.15+ within 24.x**, **pnpm 12.14.0** and **PostgreSQL 16–18**. PostgreSQL 18 is the default.

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d db
node --env-file=.env scripts/import_movies/seed.ts
pnpm dev
```

If the full Compose application is running, stop its `app` service before starting the development server on the same port: `docker compose stop app`.

```sh
pnpm check     # Catalog validation, types, lint, unit/UI tests and production build
```

See [contributing](CONTRIBUTING.md) for integration tests, data corrections and pull requests.

## Posters and portraits

The included image metadata provides TMDB posters and portraits without a runtime API key. Image files load from the provider CDN. To refresh metadata or look up missing images, set `TMDB_API_TOKEN` in `.env` to your API Read Access Token, then restart `pnpm dev` or run:

```sh
docker compose up -d --force-recreate app
```

The token stays on the server. Wikimedia Commons provides licensed images where available. Image credits are available on each card; missing images leave readable placeholders. See [data and media](docs/DATA.md).

## Host on Netlify + Neon

The repository includes a Netlify Functions API, a static Vite build and manual GitHub Actions for deployment and database setup. Git pushes do not publish the site. Follow the [Netlify + Neon setup](docs/DEPLOYMENT.md#netlify--neon-manual-deployment) for secrets, the initial catalog import and the first deployment.

## Documentation

- [Architecture](docs/ARCHITECTURE.md): project structure, game rules and persistence.
- [HTTP API](docs/API.md): endpoints, sessions, errors and request limits.
- [Data and media](docs/DATA.md): catalog sources, licensing, imports and image caching.
- [Deployment](docs/DEPLOYMENT.md): configuration, backups, catalog updates and PostgreSQL upgrades.
- [Contributing](CONTRIBUTING.md), [security](SECURITY.md) and [code of conduct](CODE_OF_CONDUCT.md).

## License

Application code, documentation and original artwork are [Apache-2.0](LICENSE). The catalog combines Wikidata facts under CC0 with TMDB records and cast credits governed by TMDB's terms. Third-party data, images and branding retain their own rights; the code license does not relicense them. See [NOTICE](NOTICE), [data provenance](data/README.md) and [screenshot credits](docs/screenshot-credits.md).
