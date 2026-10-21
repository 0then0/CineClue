# Contributing to CineClue

Bug reports, focused improvements, translations and sourced data corrections are welcome. Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Set up

Follow the [development setup](README.md#develop-locally). Use the pinned pnpm version and install with `pnpm install --frozen-lockfile`. PostgreSQL 18 is the default; the integration suite also runs on PostgreSQL 16 and 17.

## Check your changes

Run `pnpm check` before submitting a pull request. Add regression tests for changes to game rules, persistence, security or interactions. For interface changes, check keyboard operation, mobile and desktop layouts, both themes and both languages.

Integration tests write puzzles, games and hints. Run them only against a separate disposable database, never a database containing progress you want to keep:

```sh
# Set this to a separate local test database.
export DATABASE_URL=postgres://cineclue:cineclue@localhost:55432/cineclue_test
pnpm db:seed
pnpm test:integration
```

Create the database first. `db:seed` applies migrations automatically. CI runs this suite against each supported PostgreSQL major version.

`pnpm format` applies Biome formatting and safe fixes. An optional Git hook is available in `.githooks/pre-commit`; enable it with `git config core.hooksPath .githooks`.

## Submit a pull request

Explain the problem, the resulting behavior and the checks you ran. Keep unrelated refactoring separate. Use English Conventional Commit messages, such as `fix: preserve daily progress after reload` or `feat: add a localized collection`.

Do not commit credentials, database dumps, build output or downloaded provider caches. Catalog snapshots are versioned deliberately; document their sources and generation when changing them.

## Work with data

Keep stable movie and entity IDs and retain provenance. Do not merge films by title or people by name. Cite a source for corrections, prefer upstream corrections where appropriate, and run `pnpm data:validate`. See [the data guide](docs/DATA.md) before refreshing the catalog.

Collections are defined in `data/seed/packs.json`. Give each collection English and Russian labels and ensure that every difficulty has playable targets. The validator checks these pools.

For a new language, extend `apps/web/src/i18n.ts`, the language selector and metadata translations. Missing names fall back to source labels.

Code and original assets are contributed under Apache-2.0. Wikidata facts remain CC0; TMDB records and third-party media retain their own terms. Do not submit media without the required rights and attribution. Report vulnerabilities privately through the [security process](SECURITY.md).
