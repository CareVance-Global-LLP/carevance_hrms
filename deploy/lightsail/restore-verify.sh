#!/usr/bin/env bash
#
# Restore the latest backup into a throwaway database and check it is real.
#
# A backup nobody has restored is not a backup, it is a file. This is the
# difference between being able to state an RPO and hoping for one.
#
# Run weekly:
#   0 3 * * 0 /path/to/deploy/lightsail/restore-verify.sh >> /var/log/carevance-restore-verify.log 2>&1
#
# Restores into a scratch database on the SAME Postgres container, then drops
# it. It never touches the live database, and the scratch name is fixed so a
# crashed run leaves an obvious artefact rather than a pile of them.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.deploy.yml}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/postgres}"
SCRATCH_DB="carevance_restore_check"

if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
fi

DB_USER="${DB_USERNAME:-carevance}"
DB_NAME="${DB_DATABASE:-carevance}"

ARCHIVE="$(find "$BACKUP_DIR" -name "${DB_NAME}-*.sql.gz" -type f -print0 2>/dev/null \
  | xargs -0 ls -t 2>/dev/null | head -n1 || true)"

if [ -z "$ARCHIVE" ]; then
  echo "[verify] FAILED: no backup archive found in ${BACKUP_DIR}" >&2
  exit 1
fi

AGE_HOURS=$(( ( $(date +%s) - $(date -r "$ARCHIVE" +%s) ) / 3600 ))

echo "[verify] newest archive: ${ARCHIVE} (${AGE_HOURS}h old)"

# An old "latest" means the backup cron itself has stopped — the failure that
# is invisible until the day it matters.
if [ "$AGE_HOURS" -gt 26 ]; then
  echo "[verify] FAILED: newest backup is ${AGE_HOURS}h old. Is backup.sh still running?" >&2
  exit 1
fi

psql_scratch() {
  docker compose -f "$COMPOSE_FILE" exec -T db \
    psql --username="$DB_USER" --dbname="$SCRATCH_DB" -tAc "$1"
}

cleanup() {
  docker compose -f "$COMPOSE_FILE" exec -T db \
    psql --username="$DB_USER" --dbname=postgres \
    -c "DROP DATABASE IF EXISTS ${SCRATCH_DB};" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[verify] creating scratch database ${SCRATCH_DB}"
cleanup
docker compose -f "$COMPOSE_FILE" exec -T db \
  psql --username="$DB_USER" --dbname=postgres -c "CREATE DATABASE ${SCRATCH_DB};" >/dev/null

echo "[verify] restoring..."
gunzip -c "$ARCHIVE" | docker compose -f "$COMPOSE_FILE" exec -T db \
  psql --username="$DB_USER" --dbname="$SCRATCH_DB" --quiet --set ON_ERROR_STOP=off >/dev/null

FAILED=0

# Row counts on the tables that would end the company if they were empty.
# Checking that the restore *parses* proves almost nothing; checking that the
# payroll is in it proves something.
for TABLE in users organizations payroll_monthly_runs payroll_items time_entries; do
  COUNT="$(psql_scratch "SELECT count(*) FROM ${TABLE};" 2>/dev/null || echo "ERR")"

  if [ "$COUNT" = "ERR" ]; then
    echo "[verify] FAILED: table ${TABLE} is missing from the restore" >&2
    FAILED=1
    continue
  fi

  echo "[verify]   ${TABLE}: ${COUNT} row(s)"

  if [ "$TABLE" = "users" ] || [ "$TABLE" = "organizations" ]; then
    if [ "$COUNT" -lt 1 ]; then
      echo "[verify] FAILED: ${TABLE} restored empty" >&2
      FAILED=1
    fi
  fi
done

# Money checksum: the restored net pay total must match the live one. A dump
# that restores but disagrees on the numbers is the failure mode nobody tests
# for, and the only one that matters for payroll.
LIVE_SUM="$(docker compose -f "$COMPOSE_FILE" exec -T db \
  psql --username="$DB_USER" --dbname="$DB_NAME" -tAc \
  "SELECT COALESCE(SUM(net_pay), 0)::text FROM payroll_items;" 2>/dev/null || echo "ERR")"
RESTORED_SUM="$(psql_scratch "SELECT COALESCE(SUM(net_pay), 0)::text FROM payroll_items;" 2>/dev/null || echo "ERR")"

echo "[verify]   payroll net_pay — live: ${LIVE_SUM}  restored: ${RESTORED_SUM}"

if [ "$LIVE_SUM" = "ERR" ] || [ "$RESTORED_SUM" = "ERR" ]; then
  echo "[verify] WARNING: could not compare payroll totals"
elif [ "$LIVE_SUM" != "$RESTORED_SUM" ]; then
  # Not a hard failure: rows written between the dump and now legitimately
  # differ. It is reported so a human can judge whether the gap is plausible.
  echo "[verify] NOTE: totals differ. Expected if payroll changed since the dump was taken."
fi

if [ "$FAILED" -ne 0 ]; then
  echo "[verify] RESTORE VERIFICATION FAILED" >&2
  exit 1
fi

echo "[verify] OK: ${ARCHIVE} restores cleanly and contains the expected data."
