#!/bin/sh
set -eu

if [ "${APPLY_DB_SCHEMA:-1}" = "1" ]; then
  echo "Applying Prisma schema..."
  npx prisma db push --skip-generate
fi

if [ "${SEED_DATABASE:-1}" = "1" ]; then
  echo "Seeding model registry..."
  node dist/scripts/seed.js
fi

exec "$@"
