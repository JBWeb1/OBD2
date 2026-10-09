#!/usr/bin/env bash
# Daily Postgres backup with retention. Usage: DATABASE_URL=postgres://... ./scripts/backup.sh [dir] [keep_days]
# Cron example (02:30 every day):  30 2 * * * cd /opt/diagnosticos && ./scripts/backup.sh /var/backups/diagnosticos 14
set -euo pipefail
DIR="${1:-./backups}"; KEEP="${2:-14}"
: "${DATABASE_URL:?Set DATABASE_URL}"
mkdir -p "$DIR"
FILE="$DIR/diagnosticos-$(date +%Y%m%d-%H%M%S).sql.gz"
pg_dump --no-owner --dbname="$DATABASE_URL" | gzip > "$FILE"
# a backup that is suspiciously small means pg_dump failed quietly
[ "$(stat -c%s "$FILE")" -gt 1000 ] || { echo "Backup too small, treating as failed" >&2; rm -f "$FILE"; exit 1; }
find "$DIR" -name 'diagnosticos-*.sql.gz' -mtime +"$KEEP" -delete
echo "Backup written: $FILE"
# Restore:  gunzip -c FILE | psql "$DATABASE_URL"
# IMPORTANT: copy backups off the server (S3/Backblaze/another machine) and test a restore regularly.
