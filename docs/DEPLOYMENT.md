# Deployment

## Local Compose setup

The included Compose stack binds the application and PostgreSQL to `127.0.0.1`. It uses HTTP and development credentials. The app waits for the database, applies tracked migrations and seeds an empty database from `data/catalog.json`.

```sh
docker compose up --build
```

The initial 10,000-film import can take a few minutes. Subsequent starts reuse the database. The PostgreSQL volume persists until explicitly removed; do not use `docker compose down -v` when you need to retain progress.

## Netlify + Neon: manual deployment

Netlify serves `apps/web/dist` and routes `/api/*` to `netlify/functions/api.ts` before the SPA fallback. Challenge URLs such as `/challenge/<uuid>` load the frontend. The function shares the existing API handler with the Node server, including visitor cookies, origin checks, request-size limits and interactive `pg` transactions. No framework migration or additional application dependency is required.

### 1. Create the Neon database

Create a Neon project with **PostgreSQL 18**. Choose the same geographical region as the Netlify Functions region where possible. Keep scale-to-zero enabled if desired; the API has no polling timer in Functions.

In Neon **Connect**, copy both connection strings for the same database and role:
- **Pooled** URL, with `-pooler` in the hostname: used by the application.
- **Direct** URL, without `-pooler`: used by migrations and catalog imports.

Keep the TLS parameters supplied by Neon, including `sslmode=require` and `channel_binding=require` when present. Do not disable certificate verification. The existing `pg` driver keeps `BEGIN`, row locks and `COMMIT` on one client. [Neon pooling documentation](https://neon.com/docs/connect/connection-pooling).

### 2. Create the Netlify project

Import `0then0/CineClue` from GitHub, select production branch `main`, and leave the base/package directory at the repository root. Use the committed `netlify.toml`:
- Build command: `pnpm build`.
- Publish directory: `apps/web/dist`.
- Functions directory: `netlify/functions`.
- Node.js: 24; pnpm is pinned by `packageManager` in `package.json`.

Do not add a Next.js adapter. Under **Project configuration → Build & deploy**, disable Deploy Previews and branch deploys. Leave builds **active**, because stopping builds also prevents manual hooks. The committed `ignore = "exit 0"` skips Git-triggered builds; [build hooks bypass the ignore command](https://docs.netlify.com/build/configure-builds/ignore-builds/).

Choose the final site name/custom domain before setting `PUBLIC_ORIGIN`. In the Functions settings, choose a region close to Neon. The API requests 1024 MB of memory. Region changes and environment changes take effect on a new deployment.

### 3. Set Netlify environment variables

Under **Project configuration → Environment variables**, set these for the **Production** context with the **Functions** scope:
- `DATABASE_URL`: the Neon **pooled** URL.
- `DAILY_SECRET`: a stable random secret, generated locally with `openssl rand -hex 32`. Keep it across deployments and instances.
- `PUBLIC_ORIGIN`: the exact public HTTPS origin, for example `https://cineclue-0then0.netlify.app`, with no path or trailing slash.
- `TMDB_API_TOKEN`: optional server-side TMDB Read Access Token for missing media. The committed metadata works without it.

Set `AWS_LAMBDA_JS_RUNTIME=nodejs24.x` in the Netlify UI with **Builds** scope to pin the function runtime. Netlify requires this override to be set outside `netlify.toml`. The build itself already selects Node 24. See [runtime configuration](https://docs.netlify.com/build/functions/configuration/).

Do not use `VITE_` prefixes for secrets. Do not set `STATIC_ROOT`, `PORT` or `TRUSTED_PROXY_IP` for Functions. Secure cookies are always enabled by the function entry point; `context.ip` supplies the limiter identity and client forwarding headers are ignored. `NODE_ENV` is not used as a security switch by this entry point.

Production secrets should not be shared with deploy previews or branch deploys. If previews are introduced later, use a separate Neon branch and a matching origin; the production configuration intentionally permits only its exact origin.

### 4. Configure GitHub Actions

In GitHub **Settings → Environments**, create an environment named `production`. Optionally add required reviewers to gate manual operations. Restrict its deployment branches to `main`.

Under the `production` environment's **Secrets**, add:
- `NEON_MIGRATION_DATABASE_URL`: the Neon **direct** URL.
- `NETLIFY_BUILD_HOOK`: create a hook in Netlify **Build & deploy → Build hooks**, choose branch `main`, and copy its complete URL. Treat the URL as a secret. A repository Actions secret of the same name also works if no environment secret overrides it.

No Netlify personal access token or site ID is required. Neither workflow runs on push or pull request. Ordinary CI continues to run automatically without publishing.

### 5. Initialize the database, then deploy

After these changes are committed to remote `main`:
1. Open GitHub **Actions → Production database → Run workflow** on `main`. Choose `initialize-catalog`. This applies migrations, then imports the committed 10,000-film catalog only if the database is empty. It does not contact TMDB.
2. Wait for successful completion. Import runs outside Functions in a single transaction. Rows are sent in batches of at most 1,000 using parameterized JSON recordsets, with progress logged for each batch and a 30-minute workflow deadline. The importer refreshes PostgreSQL planner statistics before committing, so the first catalog load does not depend on autovacuum timing. Network latency and database compute still affect the duration. A failed import rolls back its catalog transaction and can be retried; committed migrations remain applied.
3. Open **Actions → Deploy production → Run workflow** on `main`.
4. Follow the build in Netlify **Deploys**. A green GitHub deploy-trigger workflow means Netlify accepted the hook, not that publication succeeded. The hook builds the latest remote `main` when Netlify processes it; it does not pin the triggering workflow's SHA. Avoid pushing another commit while that build is queued if a specific revision is required.
5. Open `https://<your-domain>/api/health`. Expect `{"status":"ok","movies":10000}`. Then test search, a guess, a hint, a challenge link opened directly, progress after reload, and both themes.
6. In Netlify **Functions**, verify `api` and `cleanup`. `cleanup` should have a Scheduled badge. Use **Run now** to test it; scheduled functions are not public HTTP cleanup endpoints.

For later schema-only changes, run the database workflow with `migrate` before deployment. `update-catalog` explicitly replaces catalog facts while preserving existing target snapshots. The initial-empty check runs under the import lock, so concurrent initializers cannot overwrite a catalog that another initializer has just committed. Back up the database before this operation, pause public writes while replacing catalog facts, then redeploy all functions so their in-memory catalogs match. A normal frontend/API deployment never migrates or imports data.

### Runtime limits and cold-start measurement

Each warm function instance reuses its catalog, search index, media metadata and PostgreSQL pool. The pool is capped at two connections per Lambda instance, closes idle connections after ten seconds while the instance is running, and has a fifteen-second connection timeout. Total database connections still grow with the number of concurrent function instances. No session-level database settings or independent HTTP queries replace interactive transactions.

`cleanup` deletes only expired rate-limit rows daily at **04:15 UTC**. Expired rows are not consulted by a later minute's limiter. This avoids a database query every minute while the site is idle, but the daily cleanup itself can wake Neon. The standalone Node server keeps its existing cleanup timer.

The function bundle includes `data/media.json` and `data/daily-pool.json`. They remain server-side; raw catalog snapshots are not copied into the public Vite output. No runtime writes to the deployed filesystem are required.

On each cold initialization, the function logs an `api_initialized` event with catalog size, initialization duration, RSS and JavaScript heap usage. It does not log credentials or answers. Use those logs together with Netlify invocation duration/memory metrics to measure the first request after deployment and after Neon has suspended, then compare warm requests. Check several independent cold starts before opening public traffic.

For a read-only local measurement against an explicitly configured database, run from the repository root in a fresh Node process:

```sh
AWS_LAMBDA_FUNCTION_NAME=benchmark PUBLIC_ORIGIN=https://benchmark.invalid \
  node --env-file=.env scripts/benchmark-startup.ts
```

The script calls `/api/health` twice through the actual function runtime and closes the pool. It never applies migrations or imports data. A local PostgreSQL 18 run with the 10,000-film catalog measured about 2.5 seconds for initialization, 377 MiB RSS and a 1 ms warm health request; these are development-machine observations, not Netlify/Neon latency guarantees or peak-memory measurements. Netlify routing, packaging, TLS, region latency and Neon wake-up must be verified on the deployed site.

## Standalone Docker hosting

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
