# Deployment

## Local Compose setup

The included Compose stack binds the application and PostgreSQL to `127.0.0.1`. It uses HTTP and development credentials. The app waits for the database, applies tracked migrations and seeds an empty database from `data/catalog.json`.

```sh
docker compose up --build
```

The initial 10,000-film import can take a few minutes. Subsequent starts reuse the database. The PostgreSQL volume persists until explicitly removed; do not use `docker compose down -v` when you need to retain progress.

## Public hosting

Build `docker/Dockerfile` and serve the API behind HTTPS termination. The image runs as the unprivileged `node` user and serves both `/api` and the built frontend. PostgreSQL must remain on a private network.

Supply deployment-specific values:
- `DATABASE_URL`: PostgreSQL connection string and credentials.
- `DAILY_SECRET`: private, stable secret of at least 32 characters. Generate one with `openssl rand -hex 32`.
- `PUBLIC_ORIGIN`: the exact HTTPS browser origin.
- `NODE_ENV=production`: enables Secure visitor cookies and requires an HTTPS public origin.
- `TRUSTED_PROXY_IP`: optional exact socket address of a trusted proxy; see below.
- `TMDB_API_TOKEN`: optional server-side API Read Access Token for images or imports.

`PORT` defaults to 3001. `STATIC_ROOT` points to the built frontend and is configured by the image. The application logs to stdout/stderr; `GET /api/health` checks the database and reports catalog size.

Compose sets `NODE_ENV=development` explicitly for local use. Override `app.environment.NODE_ENV` in your deployment-specific configuration; setting it only in `.env` does not override that value. Also supply the HTTPS origin and private credentials. Do not expose the local defaults publicly.

Multiple instances must share PostgreSQL, the same catalog and the same Daily secret. Shutdown stops accepting requests and closes the database pool, with a ten-second deadline.

## Proxy identity and request limits

By default, the mutation limiter uses the socket address and ignores forwarded headers. Behind a proxy, set `TRUSTED_PROXY_IP` to its exact socket address, including an IPv4-mapped IPv6 prefix if present. Configure that proxy to overwrite `X-Real-IP` with the actual client address. Requests from other socket addresses cannot use this header to choose their rate-limit identity.

Subnets and wildcards are not supported. Do not share the trusted address with untrusted applications. The built-in limit is 60 mutations per IP per minute, shared through PostgreSQL; users behind the same NAT may share a quota. Add edge limits for searches and new visitor requests according to measured traffic. No public traffic capacity guarantee is implied by the integration suite.

## Back up and restore

Back up PostgreSQL regularly, including games and Daily assignments. Dumps contain anonymous session credentials and must remain private. With the Compose database:

```sh
umask 077
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > cineclue.dump
```

To restore, stop application writes and use an empty database:

```sh
docker compose stop app
docker compose exec -T db sh -c 'pg_restore --exit-on-error --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < cineclue.dump
docker compose up -d --build --wait app
```

Do not restore over a populated database or add `--clean` without a deliberate recovery plan. Verify health and retained progress after restoration. Keep backups outside the repository.

## Update the catalog

Generate and validate a snapshot as described in [the data guide](DATA.md#refresh-the-catalog). To update an existing Compose installation:

```sh
docker compose stop app
# Take a database backup before the update.
docker compose build app
docker compose run --rm --no-deps --entrypoint node app scripts/import_movies/seed.ts
docker compose up -d --wait app
```

The seed backfills target snapshots before replacing catalog facts. Existing games and the current Daily retain their target attributes and recorded comparisons; newly created games use the corrected catalog. `--preserve-existing` performs an additive import and does not update existing cast lists.

Ordinary restarts seed only empty databases. They do not replace metadata in a populated database. Restart all API instances after an explicit catalog update.

## PostgreSQL compatibility and major upgrades

PostgreSQL 18 is the default. CI tests migrations, catalog seeding and the API integration suite on PostgreSQL 16, 17 and 18. Current pinned image versions are in `compose.yaml` and `.github/workflows/ci.yml`.

The PostgreSQL 18 image stores data under `/var/lib/postgresql/18/docker` and mounts `/var/lib/postgresql`. The Compose volume is `postgres18-data`. Older installations may use a different volume, such as `postgres-data` mounted at `/var/lib/postgresql/data`.

Major versions cannot reuse each other's data directories directly. Stop writes, take a dump with the old server, start the new major version with an empty volume, restore the dump and verify progress before removing the old volume. Keep the old image, configuration, volume and backup until verification is complete. To roll back, stop the application and restore the previous configuration and matching data volume.

See the [official image layout](https://hub.docker.com/_/postgres) and [PostgreSQL upgrade policy](https://www.postgresql.org/support/versioning/).
