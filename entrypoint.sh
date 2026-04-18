#!/bin/sh
set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Nexus — startup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Wait for PostgreSQL to be ready (important on first boot)
echo "⏳ Waiting for database..."
until node -e "
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  c.connect().then(() => { c.end(); process.exit(0); }).catch(() => process.exit(1));
" 2>/dev/null; do
  echo "   database not ready, retrying in 2s..."
  sleep 2
done
echo "✅ Database is ready"

# Run Prisma migrations (idempotent — safe to run every deploy)
echo "🔄 Running Prisma migrations..."
npx prisma migrate deploy
echo "✅ Migrations complete"

echo "🚀 Starting NestJS server on port ${PORT:-8080}..."
exec node dist/main.js