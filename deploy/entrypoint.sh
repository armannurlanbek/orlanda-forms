#!/bin/sh
# Container entrypoint: apply migrations BEFORE accepting traffic (§22), then run.
set -e

echo "[entrypoint] Applying database migrations (prisma migrate deploy)…"
./node_modules/.bin/prisma migrate deploy --schema=prisma/schema.prisma

echo "[entrypoint] Starting Orlanda Forms API…"
exec node server/dist/index.js
