#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT/.env.server"
COMPOSE_FILE="$ROOT/docker-compose.server.yml"
MODEL_FILE="$ROOT/model/v3-lite.zip"
MODEL_CONFIG="$ROOT/model/config/ppo_v3_lite_action_value_bc_finetune.yaml"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker is not installed."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: Docker Compose v2 is not available."
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ROOT/.env.server.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Created $ENV_FILE."
  echo "Edit its domain, WeChat credentials, and secrets, then run this script again."
  exit 1
fi

if grep -Eq 'api\.example\.com|CHANGE_TO_' "$ENV_FILE"; then
  echo "ERROR: $ENV_FILE still contains placeholder values."
  exit 1
fi

if [[ ! -f "$MODEL_FILE" ]]; then
  echo "ERROR: AI model not found: $MODEL_FILE"
  exit 1
fi

if [[ ! -f "$MODEL_CONFIG" ]]; then
  echo "ERROR: AI config not found: $MODEL_CONFIG"
  exit 1
fi

chmod 600 "$ENV_FILE"

echo "[1/4] Validating Docker Compose configuration..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet

echo "[2/4] Building application images..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build

echo "[3/4] Starting services..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --remove-orphans --wait --wait-timeout 300

echo "[4/4] Current service status:"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps

DOMAIN="$(sed -n 's/^SERVER_DOMAIN=//p' "$ENV_FILE" | tail -n 1)"
echo
echo "Deployment started."
echo "Health URL: https://$DOMAIN/api/health"
echo "Follow logs: docker compose --env-file .env.server -f docker-compose.server.yml logs -f"
