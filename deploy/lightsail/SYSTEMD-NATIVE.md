# The long-running processes production actually runs

Recorded 25 Aug 2026. Production is a **native** deploy — systemd units on the
host, not docker-compose. `docker-compose.deploy.yml` describes a stack nothing
runs.

## What exists

| Unit | Runs | Status |
|---|---|---|
| `carevance-backend.service` | the Laravel app | pre-existing |
| `carevance-queue.service` | `queue:work` | pre-existing |
| `carevance-reverb.service` | `reverb:start --port=8081` | **added 25 Aug 2026** |

## Reverb

`/etc/systemd/system/carevance-reverb.service`:

```ini
[Unit]
Description=CareVance Reverb WebSocket Server
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/var/www/carevance/backend
ExecStart=/usr/bin/php8.4 /var/www/carevance/backend/artisan reverb:start --host=127.0.0.1 --port=8081
Restart=always
RestartSec=5
StartLimitBurst=0

[Install]
WantedBy=multi-user.target
```

**Port 8081, not 8080.** nginx already binds `127.0.0.1:8080` for the internal
backend vhost. Reverb on 8080 never starts — systemd reports `activating`
forever while it retries a port it cannot have.

**Binds to 127.0.0.1, not 0.0.0.0.** nginx proxies `/app/` to it; nothing
proxies `/apps/`, which is the HMAC-authenticated publish API. Binding to all
interfaces would expose that directly.

Required in `backend/.env` — `BROADCAST_CONNECTION` was `log`, which writes
broadcasts to a log file and delivers nothing:

```
BROADCAST_CONNECTION=reverb
REVERB_APP_ID / REVERB_APP_KEY / REVERB_APP_SECRET
REVERB_SERVER_HOST=127.0.0.1   REVERB_SERVER_PORT=8081   # what it binds
REVERB_HOST=127.0.0.1          REVERB_PORT=8081          # what the backend publishes to
REVERB_SCHEME=http
```

`VITE_REVERB_APP_KEY` in `/var/www/carevance/frontend/dist/env-config.js` must
match `REVERB_APP_KEY` **exactly**. A mismatch fails at subscribe time,
silently, and is indistinguishable from the daemon being down.

## The scheduler — MOSTLY STILL OFF

There is no `schedule:work` service and no `schedule:run` cron. **Fourteen
scheduled tasks have never run in this environment.**

Two are now covered by a `www-data` crontab, added 25 Aug 2026:

```cron
* * * * *    cd /var/www/carevance/backend && /usr/bin/php8.4 artisan timers:close-idle --silent
*/15 * * * * cd /var/www/carevance/backend && /usr/bin/php8.4 artisan timers:close-stale
```

Both were dry-run first and reported nothing to close.

These two rather than `schedule:work` deliberately. The other twelve have never
run, so switching them all on together means each catching up on months of
missed periods in a single pass:

- `leave-accrue` (daily) — **leave balances have never accrued automatically**
- `billing-roll-cycle` (daily) — subscription cycles do not advance
- `screenshots-purge` (nightly) — nothing has ever been swept; would delete a
  large backlog at once
- plus reminders, overdue alerts, biometric processing, lifecycle, recurrences

The tracker pair has no catch-up behaviour and a real cost to leaving off: the
only other thing that can stop an idle timer is the desktop app, which cannot
act once it is closed, asleep or crashed.

**Before enabling the rest, dry-run each.** `timers:close-idle` has
`--dry-run`; check the others before trusting a first run.
