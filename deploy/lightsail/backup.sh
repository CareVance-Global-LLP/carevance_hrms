#!/usr/bin/env bash
#
# Automated database backup.
#
# Before this existed, backup was a line of advice printed at the end of
# deploy.sh — "3. Set up automated backups for the database" — and nothing
# more. A single Lightsail instance held the only copy of every payslip,
# filing and attendance record for every tenant.
#
# Install as a cron on the host, e.g. hourly:
#   0 * * * * /path/to/deploy/lightsail/backup.sh >> /var/log/carevance-backup.log 2>&1
#
# Set BACKUP_S3_BUCKET to ship off-box. Without it backups stay on the same
# disk as the database, which protects against `DROP TABLE` but not against
# losing the instance — say so out loud rather than letting it look solved.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.deploy.yml}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/postgres}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
fi

DB_USER="${DB_USERNAME:-carevance}"
DB_NAME="${DB_DATABASE:-carevance}"

mkdir -p "$BACKUP_DIR"

ARCHIVE="$BACKUP_DIR/${DB_NAME}-${TIMESTAMP}.sql.gz"

echo "[backup] dumping ${DB_NAME} -> ${ARCHIVE}"

# --clean --if-exists so the dump can be restored over an existing database
# without hand-editing. Piped straight to gzip: a full dump of a payroll
# database does not want to exist uncompressed on a small instance.
docker compose -f "$COMPOSE_FILE" exec -T db \
  pg_dump --username="$DB_USER" --dbname="$DB_NAME" --clean --if-exists \
  | gzip -9 > "$ARCHIVE"

# A zero-length or truncated archive is worse than no archive, because it
# looks like a backup. Check before anything is pruned.
if [ ! -s "$ARCHIVE" ]; then
  echo "[backup] FAILED: archive is empty" >&2
  rm -f "$ARCHIVE"
  exit 1
fi

if ! gzip -t "$ARCHIVE"; then
  echo "[backup] FAILED: archive is corrupt" >&2
  rm -f "$ARCHIVE"
  exit 1
fi

SIZE="$(du -h "$ARCHIVE" | cut -f1)"
echo "[backup] ok: ${ARCHIVE} (${SIZE})"

if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  echo "[backup] uploading to s3://${BACKUP_S3_BUCKET}/postgres/"
  aws s3 cp "$ARCHIVE" "s3://${BACKUP_S3_BUCKET}/postgres/" --only-show-errors
  echo "[backup] uploaded"
else
  echo "[backup] WARNING: BACKUP_S3_BUCKET is not set."
  echo "[backup] Backups are on the same disk as the database. That survives a bad"
  echo "[backup] migration but not the loss of this instance. Set BACKUP_S3_BUCKET."
fi

# Prune only after a verified new archive exists.
find "$BACKUP_DIR" -name "${DB_NAME}-*.sql.gz" -type f -mtime "+${RETENTION_DAYS}" -print -delete

echo "[backup] retained $(find "$BACKUP_DIR" -name "${DB_NAME}-*.sql.gz" -type f | wc -l) archive(s)"
