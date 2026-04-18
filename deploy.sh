#!/usr/bin/env bash
# deploy.sh — розгортання Nexus на Fly.io
# Використання: chmod +x deploy.sh && ./deploy.sh

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[deploy]${NC} $1"; }
ok()   { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# Перевірка залежностей
command -v fly  &>/dev/null || err "Fly CLI не встановлено. Встанови: https://fly.io/docs/hands-on/install-flyctl/"
command -v node &>/dev/null || err "Node.js не встановлено"

log "Перевірка авторизації Fly.io..."
fly auth whoami &>/dev/null || { warn "Не авторизований. Запускаю fly auth login..."; fly auth login; }
ok "Авторизований в Fly.io"

APP_NAME=$(grep '^app' fly.toml | sed "s/app *= *'\(.*\)'/\1/")
log "Додаток: ${APP_NAME}"

# Перший деплой?
if ! fly apps list | grep -q "${APP_NAME}"; then
  log "Перший деплой — створюємо додаток..."
  fly apps create "${APP_NAME}"

  # PostgreSQL
  log "Створюємо Fly Postgres (безкоштовний план)..."
  fly postgres create \
    --name "${APP_NAME}-db" \
    --region fra \
    --vm-size shared-cpu-1x \
    --volume-size 1 \
    --initial-cluster-size 1

  log "Приєднуємо PostgreSQL до додатку..."
  fly postgres attach "${APP_NAME}-db" --app "${APP_NAME}"
  ok "DATABASE_URL встановлено автоматично"

  # Секрети
  warn "═══════════════════════════════════════════════"
  warn "ПОТРІБНО ВСТАНОВИТИ СЕКРЕТИ!"
  warn ""
  warn "1. JWT_SECRET:"
  warn "   fly secrets set JWT_SECRET=\$(node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\")"
  warn ""
  warn "2. OPAQUE_SERVER_SETUP:"
  warn "   Запусти сервер локально один раз БЕЗ цієї змінної,"
  warn "   скопіюй значення з логів, потім:"
  warn "   fly secrets set OPAQUE_SERVER_SETUP=<значення>"
  warn ""
  warn "3. ALLOWED_ORIGINS (після першого деплою):"
  warn "   fly secrets set ALLOWED_ORIGINS=https://${APP_NAME}.fly.dev"
  warn "═══════════════════════════════════════════════"

  read -p "Встановив секрети? (y/N) " -n 1 -r
  echo
  [[ $REPLY =~ ^[Yy]$ ]] || { warn "Встанови секрети і запусти deploy.sh знову"; exit 0; }
fi

# Deploy
log "Деплоїмо..."
fly deploy --remote-only

ok "═══════════════════════════════════════════════"
ok "Деплой завершено!"
ok ""
ok "🌐 Додаток: https://${APP_NAME}.fly.dev"
ok "📊 Dashboard: https://fly.io/apps/${APP_NAME}"
ok ""
ok "Корисні команди:"
ok "  fly logs -a ${APP_NAME}          # логи в реальному часі"
ok "  fly ssh console -a ${APP_NAME}   # SSH в контейнер"
ok "  fly secrets list -a ${APP_NAME}  # список секретів"
ok "═══════════════════════════════════════════════"