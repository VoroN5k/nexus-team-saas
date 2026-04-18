#!/bin/sh
set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Nexus — startup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "🔄 Running Prisma migrations..."
npx prisma migrate deploy
echo "✅ Migrations complete"

echo "🚀 Starting NestJS server on port ${PORT:-8080}..."

# Знайти main.js автоматично (шлях залежить від tsconfig rootDir)
MAIN_JS=$(find /app/dist -name "main.js" | head -1)
if [ -z "$MAIN_JS" ]; then
  echo "❌ ERROR: dist/main.js not found!"
  echo "Contents of /app/dist:"
  find /app/dist -type f | head -20
  exit 1
fi

echo "📦 Starting: $MAIN_JS"
exec node "$MAIN_JS"