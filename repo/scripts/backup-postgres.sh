#!/usr/bin/env sh
set -eu

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="${BACKUP_DIR}/meta_ads_analytics_${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"
docker compose exec -T postgres pg_dump \
  -U "${POSTGRES_USER:-meta_ads}" \
  -d "${POSTGRES_DB:-meta_ads_analytics}" \
  -F c \
  -f "/tmp/${TIMESTAMP}.dump"
docker compose cp "postgres:/tmp/${TIMESTAMP}.dump" "$FILE"
docker compose exec -T postgres rm -f "/tmp/${TIMESTAMP}.dump"

echo "Backup written to ${FILE}"
