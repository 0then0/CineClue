#!/bin/sh
set -eu
node apps/api/src/migrate.ts
node scripts/import_movies/seed.ts --if-empty
exec node apps/api/src/server.ts
