# Production runbook

What has to exist outside this repository for the code in it to be safe.

Everything here is **optional by construction** — the application runs without any of
it, exactly as it did before. Each item is a switch you turn on. That is deliberate: a
change that breaks an existing deployment on the day it ships gets reverted, and then
nothing improves.

---

## The honest starting position

Production is one Lightsail instance running Postgres, the API, the queue worker, the
scheduler, the frontend and Caddy. There is no replica, no managed database, no load
balancer. Until the steps below are done:

- **We cannot state an RPO or an RTO.** If that instance's volume is lost, every
  payslip, filing, screenshot and attendance record for every tenant is gone.
- Backups exist only if step 1 is done.

Do not tell a customer otherwise.

---

## 1. Backups — do this first

Nothing else on this page matters as much.

```bash
# On the host, as the deploy user:
crontab -e
```

```cron
# Hourly backup, verified weekly.
0 * * * * /path/to/deploy/lightsail/backup.sh   >> /var/log/carevance-backup.log 2>&1
0 3 * * 0 /path/to/deploy/lightsail/restore-verify.sh >> /var/log/carevance-restore-verify.log 2>&1
```

`backup.sh` refuses to prune old archives until the new one is written and verified
non-empty and non-corrupt, so a failing dump cannot quietly eat the history.

`restore-verify.sh` restores the newest archive into a scratch database, checks the
tables that matter are present and populated, and compares the payroll `net_pay` total
against the live one. **A backup nobody has restored is a file, not a backup.**

### Ship backups off the box

```bash
# .env
BACKUP_S3_BUCKET=carevance-backups-prod
```

Without this, backups sit on the same disk as the database. That protects against a bad
migration. It does not protect against losing the instance, which is the scenario that
ends the company. `backup.sh` prints a warning every run until it is set.

The host needs the AWS CLI and a credential with `s3:PutObject` on that bucket only.
Enable **versioning** and **Object Lock** on the bucket so an attacker with the deploy
credential cannot delete the backups.

---

## 2. Object storage

```bash
# .env
AWS_BUCKET=carevance-media-prod
AWS_DEFAULT_REGION=ap-south-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

Setting `AWS_BUCKET` moves screenshots, employee documents and chat attachments to S3
automatically. Leave it unset and they stay on the local volume.

Until this is set, a second application node is impossible: screenshots written by one
node are invisible to the other.

The bucket must be **private**. The application serves screenshots through short-lived
signed URLs; a public bucket makes that pointless.

---

## 3. Redis

Already in `docker-compose.deploy.yml`. It starts with the stack, and the application
picks it up automatically — cache, sessions and the queue all move to Redis the moment
`REDIS_HOST` is set, and fall back to the database when it is not.

Nothing to do unless you are running Redis elsewhere:

```bash
# .env — only if not using the bundled container
REDIS_HOST=your-redis-host
REDIS_PORT=6379
```

Why it matters: `CACHE_STORE`, `SESSION_DRIVER` and `QUEUE_CONNECTION` all defaulted to
`database`, so every cache read and queue poll was a write to the same Postgres that
computes payroll. Month-end contended with ordinary attendance traffic on one connection
pool.

---

## 4. Error tracking

```bash
# .env
SENTRY_LARAVEL_DSN=https://...@...ingest.sentry.io/...
SENTRY_TRACES_SAMPLE_RATE=0.1
```

Unset, the SDK no-ops entirely. Set, unhandled exceptions and slow transactions are
reported.

Before this there was no error tracking of any kind: a 500 wrote a line to a log file on
a single instance, so nobody learned a payroll run had broken until a customer said so.

---

## 5. Watch the two processes that fail silently

`GET /api/health` now reports both. Point an uptime monitor at it and alert on
`status != "healthy"`.

```json
{
  "status": "degraded",
  "queue":     { "state": "stalled", "pending": 42, "oldest_pending_age_seconds": 5400,
                 "note": "The oldest job has waited over 15 minutes. Is `php artisan queue:work` running?" },
  "scheduler": { "state": "stalled", "age_minutes": 73,
                 "note": "The scheduler has not run for 73 minutes. Idle timers will not close..." }
}
```

| Endpoint | Purpose | Point at it |
|---|---|---|
| `/api/health/simple` | Liveness — is PHP executing | Container healthcheck |
| `/api/health` | Readiness and operational truth | Uptime monitor, status page |

**Why this exists.** Both processes are mandatory and both fail quietly:

- Without the worker, `process-remaining` returns **202** and the payroll run simply
  never happens.
- Without the scheduler, `timers:close-idle` never runs and the only thing that can stop
  an idle timer is the desktop app — which cannot act once it is closed, asleep or
  crashed. Measured with no scheduler running: time entry #2114 started at 17:59 and was
  still open at midday the next day.

Money stays correct either way — every auto-stop path rewinds `end_time` to the last real
activity — but a timer that appears to run all night destroys trust in the numbers.

---

## 6. Encrypting employee PII

Employee PAN, Aadhaar, UAN, ESI, bank account and UPI values are encrypted at rest by
migration `2026_08_19_000030_encrypt_employee_pii_phase_one`.

**It is a two-phase change and phase two is manual, on purpose.**

```bash
# 1. Deploy. The migration encrypts in place and KEEPS the plaintext in
#    <column>_plain_backup so nothing is lost if anything is wrong.

# 2. Prove it worked.
php artisan pii:verify-encryption

# 3. Only when that reports clean, and only when you are satisfied:
php artisan pii:drop-plaintext-backups
```

Step 3 is irreversible except from a backup taken before it. It is a command rather than
a migration precisely so it cannot run itself on a deploy.

```bash
# .env — set once, before the migration runs, and then never rotate casually.
PII_INDEX_KEY=<64 hex chars: php -r "echo bin2hex(random_bytes(32));">
```

This keys the blind-index columns that make `WHERE pan_number = ?` still work. Changing
it invalidates every stored index and requires a decrypt-and-rewrite pass over every row.
`APP_KEY`, which encrypts the values themselves, rotates normally via `APP_PREVIOUS_KEYS`.

---

## 7. Two-factor authentication

Enrolment is available immediately. Enforcement is per organisation:

| `settings.security.mfa_policy` | Effect |
|---|---|
| `off` | Available, never required |
| `grace` *(default)* | Required for admin / HR / payroll roles once the window closes (14 days) |
| `enforced` | Required for those roles immediately |

Employees and line managers are never blocked.

Before switching an organisation to `enforced`, check its owner has enrolled — and that
outbound mail works, because recovery runs through it.

---

## 8. Monitoring consent

Screenshot, activity, location and selfie capture now require a published notice and
employee consent.

| `settings.monitoring.consent_policy` | Effect |
|---|---|
| `off` | No consent checked |
| `grace` *(default)* | Capture continues for 30 days after the notice is published |
| `enforced` | Capture refused without consent |

`settings.monitoring.enabled = false` is the kill switch and wins over everything.

Publish a notice via `POST /api/monitoring/notice` before enabling `enforced`, or every
capture is refused.

---

## Still outstanding

Stated plainly so nobody assumes otherwise:

- **No high availability.** One instance, one database. Steps 1–2 make recovery possible;
  they do not make it fast, and they do not remove the single point of failure. Managed
  Postgres with PITR and a second application node is the real fix.
- **No load test.** Nothing here proves the stack survives 3× the contracted seat count.
- **No SOC 2 / ISO 27001.** Most of the control set now exists; the audit does not.
