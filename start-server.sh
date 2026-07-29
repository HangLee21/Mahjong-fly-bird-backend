#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT/backend"
AI_VENV="$ROOT/.venv-ai"
MODEL_PATH="${SB3_MODEL_PATH:-$ROOT/model/v3-lite.zip}"
MODEL_CONFIG="${MAHJONG_AI_CONFIG:-$ROOT/model/config/ppo_v3_lite_action_value_bc_finetune.yaml}"
POSTGRES_HOST_PORT="${POSTGRES_HOST_PORT:-15432}"
SB3_ALGO="${SB3_ALGO:-MASKABLEPPO}"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-3000}"
AI_HOST="${AI_HOST:-0.0.0.0}"
AI_PORT="${AI_PORT:-8001}"
RUN_DOCKER="${RUN_DOCKER:-1}"
RUN_SEED="${RUN_SEED:-1}"
REDIS_PASSWORD="${REDIS_PASSWORD:-mahjong_redis_local_password}"

AI_PID=""

cleanup() {
  if [[ -n "$AI_PID" ]] && kill -0 "$AI_PID" >/dev/null 2>&1; then
    kill "$AI_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

echo "[1/8] Checking model file..."
if [[ ! -f "$MODEL_PATH" ]]; then
  echo "ERROR: Model file not found: $MODEL_PATH"
  echo "Put v3-lite.zip under $ROOT/model or set SB3_MODEL_PATH."
  exit 1
fi

echo "[2/8] Preparing backend .env..."
if [[ ! -f "$BACKEND_DIR/.env" ]]; then
  cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
fi
if grep -q '^REDIS_PASSWORD=' "$BACKEND_DIR/.env"; then
  sed -i "s#^REDIS_PASSWORD=.*#REDIS_PASSWORD=$REDIS_PASSWORD#" "$BACKEND_DIR/.env"
else
  printf '\nREDIS_PASSWORD=%s\n' "$REDIS_PASSWORD" >> "$BACKEND_DIR/.env"
fi
if grep -q '^REDIS_URL=' "$BACKEND_DIR/.env"; then
  sed -i "s#^REDIS_URL=.*#REDIS_URL=redis://:$REDIS_PASSWORD@127.0.0.1:6379#" "$BACKEND_DIR/.env"
else
  printf 'REDIS_URL=redis://:%s@127.0.0.1:6379\n' "$REDIS_PASSWORD" >> "$BACKEND_DIR/.env"
fi
if grep -q '^DATABASE_URL=' "$BACKEND_DIR/.env"; then
  sed -i "s#^DATABASE_URL=.*#DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:$POSTGRES_HOST_PORT/mahjong#" "$BACKEND_DIR/.env"
else
  printf 'DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:%s/mahjong\n' "$POSTGRES_HOST_PORT" >> "$BACKEND_DIR/.env"
fi

if [[ "$RUN_DOCKER" != "0" ]]; then
  echo "[3/8] Starting PostgreSQL and Redis with Docker Compose..."
  export REDIS_PASSWORD
  docker compose -f "$BACKEND_DIR/docker-compose.yml" up -d --force-recreate postgres redis
else
  echo "[3/8] Skipping Docker Compose because RUN_DOCKER=0."
fi

echo "[4/8] Installing backend dependencies..."
cd "$BACKEND_DIR"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

echo "[5/8] Preparing Prisma database..."
npm run prisma:generate
npx prisma db push
if [[ "$RUN_SEED" != "0" ]]; then
  npm run seed
fi

echo "[6/8] Building backend..."
npm run build

echo "[7/8] Preparing Python AI environment..."
cd "$ROOT"
if [[ ! -x "$AI_VENV/bin/python" ]]; then
  python3 -m venv "$AI_VENV"
fi
"$AI_VENV/bin/python" -m pip install --upgrade pip
"$AI_VENV/bin/python" -m pip install -r "$ROOT/ai_service/requirements.txt"

echo "[8/8] Starting AI service and backend..."
if "$AI_VENV/bin/python" -c "import ai_service.server" >/dev/null 2>&1; then
  export MAHJONG_AI_MODEL="$MODEL_PATH"
  export MAHJONG_AI_CONFIG="$MODEL_CONFIG"
  "$AI_VENV/bin/python" -m ai_service.server --host "$AI_HOST" --port "$AI_PORT" --model "$MODEL_PATH" --config "$MODEL_CONFIG" &
else
  echo "WARN: ai_service.server is missing training package dependencies. Falling back to compatibility /ai/act server."
  export SB3_MODEL_PATH="$MODEL_PATH"
  export SB3_ALGO
  "$AI_VENV/bin/python" -m uvicorn ai_service.sb3_server:app --host "$AI_HOST" --port "$AI_PORT" &
fi
AI_PID="$!"

cd "$BACKEND_DIR"
export HOST
export PORT
export AI_SERVICE_URL="${AI_SERVICE_URL:-http://127.0.0.1:$AI_PORT}"

echo "Backend: http://$HOST:$PORT/api"
echo "WebSocket: ws://$HOST:$PORT/ws?token=TOKEN"
echo "AI service: http://$AI_HOST:$AI_PORT"
echo "Press Ctrl+C to stop backend and AI service."

npm start
