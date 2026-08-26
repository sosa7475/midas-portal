#!/usr/bin/env bash
# Deploy the Midas API to Fly. Run AFTER `flyctl auth login` and after filling
# the two slots in deploy/.env.fly. Idempotent — safe to re-run.
set -euo pipefail

FLY="${FLY:-$HOME/.fly/bin/flyctl}"
APP="midas-portal-api"
REGION="iad"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/deploy/.env.fly"

cd "$ROOT"

# 1. Auth check
if ! "$FLY" auth whoami >/dev/null 2>&1; then
  echo "❌ Not logged into Fly. Run:  $FLY auth login"
  exit 1
fi
echo "✓ Fly user: $("$FLY" auth whoami 2>/dev/null)"

# 2. Validate the two slots are filled
if grep -q "PASTE_NEON_URL_HERE" "$ENV_FILE"; then
  echo "❌ DATABASE_URL still a placeholder in deploy/.env.fly — paste your Neon URL."; exit 1
fi
if grep -q "PASTE_LLM_KEY_HERE" "$ENV_FILE"; then
  echo "❌ OPENAI_API_KEY still a placeholder in deploy/.env.fly — paste your LLM key."; exit 1
fi

# 3. Create app if missing
if ! "$FLY" apps list 2>/dev/null | grep -q "^$APP"; then
  echo "→ creating app $APP"
  "$FLY" apps create "$APP" -o personal
fi

# 4. Create upload volume if missing
if ! "$FLY" volumes list -a "$APP" 2>/dev/null | grep -q "midas_uploads"; then
  echo "→ creating volume midas_uploads"
  "$FLY" volumes create midas_uploads --size 1 --region "$REGION" -a "$APP" --yes
fi

# 5. Import secrets (clean KEY=value lines only), then deploy
echo "→ setting secrets"
grep -E '^[A-Z_]+=' "$ENV_FILE" | grep -v 'PASTE_' | "$FLY" secrets import -a "$APP"

echo "→ deploying (remote builder; migrations run via release_command)"
"$FLY" deploy "$ROOT" --config "$ROOT/apps/api/fly.toml" --dockerfile "$ROOT/apps/api/Dockerfile" -a "$APP" --remote-only

echo "→ health check"
sleep 3
curl -s "https://$APP.fly.dev/health" && echo && echo "✅ API live at https://$APP.fly.dev"
