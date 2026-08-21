#!/usr/bin/env bash
#
# Hourly Postgres backup to S3.
#
# Step 1 of the runbook, which until now was written down and never run. The
# runbook states the consequence plainly: production is one Lightsail instance,
# and if its volume is lost, every payslip, filing, screenshot and attendance
# record for every tenant is gone.
#
# Two rules this script exists to enforce:
#
#   1. A backup that lives on the volume it protects is not a backup. The local
#      copy is a staging file and is deleted; S3 is the backup.
#   2. A backup nobody has restored is a hypothesis. Run restore-verify.sh
#      monthly — the time it takes IS your RTO, and you cannot quote a number
#      you have never measured.
#
# Install (as the deploy user):
#   sudo cp backup-to-s3.sh /usr/local/bin/carevance-backup
#   sudo chmod +x /usr/local/bin/carevance-backup
#   ( crontab -l 2>/dev/null; echo "17 * * * * /usr/local/bin/carevance-backup >> /var/log/carevance-backup.log 2>&1" ) | crontab -
#
# Minute 17 rather than 0: every cron on every box fires on the hour, and a
# pg_dump competing with the rest of them is a slower dump on a busier disk.

set -euo pipefail

# ---- configuration -----------------------------------------------------------
# Read from the app's own .env so credentials live in exactly one place.
ENV_FILE="${CAREVANCE_ENV_FILE:-/var/www/carevance/backend/.env}"
S3_BUCKET="${CAREVANCE_BACKUP_BUCKET:-}"          # e.g. s3://carevance-backups
RETAIN_LOCAL_MINUTES=120

if [[ -z "$S3_BUCKET" ]]; then
  echo "FATAL: set CAREVANCE_BACKUP_BUCKET (e.g. s3://carevance-backups)." >&2
  exit 1
fi

if [[ ! -r "$ENV_FILE" ]]; then
  echo "FATAL: cannot read $ENV_FILE" >&2
  exit 1
fi

# Pull only the DB_* keys. Deliberately not `source`: .env is not shell, and a
# value containing a space or a '#' would either break or silently truncate.
env_value() {
  sed -n "s/^$1=//p" "$ENV_FILE" | head -1 | sed 's/^"\(.*\)"$/\1/; s/^'"'"'\(.*\)'"'"'$/\1/'
}

DB_HOST="$(env_value DB_HOST)"; DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="$(env_value DB_PORT)"; DB_PORT="${DB_PORT:-5432}"
DB_DATABASE="$(env_value DB_DATABASE)"
DB_USERNAME="$(env_value DB_USERNAME)"
DB_PASSWORD="$(env_value DB_PASSWORD)"

if [[ -z "$DB_DATABASE" || -z "$DB_USERNAME" ]]; then
  echo "FATAL: DB_DATABASE or DB_USERNAME missing from $ENV_FILE" >&2
  exit 1
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORKDIR="$(mktemp -d /tmp/carevance-backup.XXXXXX)"
DUMP="$WORKDIR/${DB_DATABASE}-${STAMP}.dump"

# Always clean up the staging copy, including on failure — rule 1 above.
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

echo "[$(date -uIs)] dumping ${DB_DATABASE}"

# -Fc: custom format. Compressed, and restorable table-by-table with pg_restore,
# which matters when the thing you need back is one tenant's payroll rather than
# the whole cluster.
PGPASSWORD="$DB_PASSWORD" pg_dump \
  --host="$DB_HOST" --port="$DB_PORT" \
  --username="$DB_USERNAME" --dbname="$DB_DATABASE" \
  --format=custom --compress=6 --no-owner --no-privileges \
  --file="$DUMP"

SIZE="$(stat -c %s "$DUMP")"

# A dump that is suspiciously small usually means pg_dump failed in a way that
# still exited 0 — an empty schema, a permissions problem. Refuse to upload it
# over a good one.
if (( SIZE < 51200 )); then
  echo "FATAL: dump is only ${SIZE} bytes; refusing to upload. Investigate before the next run." >&2
  exit 1
fi

# Verify the archive is readable before it becomes the backup of record.
PGPASSWORD="$DB_PASSWORD" pg_restore --list "$DUMP" > /dev/null

echo "[$(date -uIs)] uploading ${SIZE} bytes"

# Server-side encryption; the bucket should also have versioning and a lifecycle
# rule (24 hourly -> 30 daily -> 12 monthly). Lifecycle belongs in the bucket
# config, not here: a retention policy enforced by a cron that fails to run is
# not a retention policy.
aws s3 cp "$DUMP" "${S3_BUCKET}/hourly/$(date -u +%Y/%m/%d)/$(basename "$DUMP")" \
  --sse AES256 --only-show-errors

echo "[$(date -uIs)] uploaded ok"

# Sweep any stragglers from earlier failed runs.
find /tmp -maxdepth 1 -name 'carevance-backup.*' -type d -mmin "+${RETAIN_LOCAL_MINUTES}" -exec rm -rf {} + 2>/dev/null || true

echo "[$(date -uIs)] done"
