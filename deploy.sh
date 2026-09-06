#!/usr/bin/env bash
# Deploy DonutSMP Tracker (Pulse). Run on the host with this repo as build context
# (e.g. /opt/donutsmp-tracker). Secrets come from .env (gitignored) via --env-file,
# never from the command line, so keys don't land in shell history.
set -euo pipefail

cd "$(dirname "$0")"

ENV_FILE="${ENV_FILE:-.env}"
[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE — copy .env.example and fill keys" >&2; exit 1; }

# Override if docker needs sudo:  DOCKER="sudo docker" ./deploy.sh
DOCKER="${DOCKER:-docker}"
IMAGE="donutsmp-tracker-new"
CONTAINER="donutsmp-tracker"

echo "==> Building $IMAGE"
$DOCKER build -q -t "$IMAGE" .

echo "==> Replacing container $CONTAINER"
$DOCKER rm -f "$CONTAINER" >/dev/null 2>&1 || true

echo "==> Running $CONTAINER"
$DOCKER run -d --name "$CONTAINER" \
  --restart unless-stopped \
  -p 4201:3001 \
  -v pulse-data:/app/data \
  --env-file "$ENV_FILE" \
  "$IMAGE"

echo "==> Waiting for health…"
for _ in $(seq 1 30); do
  if curl -sf http://127.0.0.1:4201/api/health >/dev/null 2>&1; then
    echo "==> Healthy:"
    curl -s http://127.0.0.1:4201/api/health | head -c 300
    echo ""
    exit 0
  fi
  sleep 2
done
echo "==> Health check timed out — recent logs:" >&2
$DOCKER logs --tail 40 "$CONTAINER" 2>&1
exit 1
