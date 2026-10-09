#!/usr/bin/env bash
# Резервная копия базы: сжатый дамп в папку backups/ (по умолчанию хранятся последние 14).
# Нужен pg_dump той же или более новой версии, что и сервер PostgreSQL.
#   DATABASE_URL=postgres://... ./scripts/backup.sh
# Восстановить:  gunzip -c backups/snake-ГГГГ-ММ-ДД_ЧЧММ.sql.gz | psql "$DATABASE_URL"
# На Render у платных баз есть ежедневные бэкапы в панели; этот скрипт — для своих копий (например, по cron).
set -euo pipefail
: "${DATABASE_URL:?Укажи DATABASE_URL}"
DIR="${BACKUP_DIR:-backups}"; KEEP="${BACKUP_KEEP:-14}"
mkdir -p "$DIR"
FILE="$DIR/snake-$(date -u +%Y-%m-%d_%H%M).sql.gz"
pg_dump --no-owner --no-privileges "$DATABASE_URL" | gzip -9 > "$FILE"
echo "saved $FILE ($(du -h "$FILE" | cut -f1))"
ls -1t "$DIR"/snake-*.sql.gz | tail -n +$((KEEP + 1)) | xargs -r rm -f
