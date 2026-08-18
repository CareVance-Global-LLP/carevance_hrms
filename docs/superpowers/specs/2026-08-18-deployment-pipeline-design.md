# Deployment pipeline hardening

**Date:** 2026-08-18
**Status:** approved, not yet implemented
**Scope:** CareVance Lightsail deployment — runtime, CI gating, rollback, data safety

## Why

The deployment works, but three properties an internal-testing deployment needs
are missing, and one is a live defect rather than an omission.

1. **The app is served by a development server.** `backend/Dockerfile` ends in
   `php artisan serve`, which Laravel documents as single-threaded and not for
   production. Two concurrent testers serialise behind each other.
2. **Deploys are not gated on tests.** `.github/workflows/tests.yml` and
   `.github/workflows/deploy-lightsail.yml` both trigger on push to `main`,
   independently. Nothing makes deploy wait, so a red build ships.
3. **There is no TLS.** Beyond the obvious, this blocks two concrete things:
   Google OAuth requires HTTPS origins, and the desktop app refuses to package
   against a remote `http://` URL (`isAllowedAppUrl`, `desktop/main.cjs`).
4. **A bad deploy stays up.** The two post-deploy checks in the workflow end in
   `|| true`, so they cannot fail the job. Images are already tagged by commit
   SHA — the material for rollback exists and nothing uses it.

## Compose file divergence (fix first, it is confusing)

Three compose files disagree, and which one runs depends on how you deployed:

| File | Used by | State |
|---|---|---|
| `docker-compose.ci.yml` | `.github/workflows/deploy-lightsail.yml` | Correct. No `QUEUE_CONNECTION` override; both `backend` and `queue` inherit `database` from `.env`. Has `depends_on: condition: service_healthy`. |
| `docker-compose.production.yml` | `deploy.sh` (manual) | **Defective.** Sets `QUEUE_CONNECTION: "sync"` on `backend` while `queue` runs `database`. The web container then dispatches inline and the worker polls an empty table. Also lacks the healthcheck conditions. |
| `docker-compose.yml` | local/dev | Out of scope. |

Under `production.yml`, `POST /payroll/runs/{id}/process-remaining` returns 202
and then runs inline under the container's `PHP_MAX_EXECUTION_TIME: 300`, while
the job itself declares `timeout = 3600`. A real payroll run dies at five
minutes, half-processed. `SendInvitationMail` declares `tries = 3`; the sync
driver does not retry, so one SMTP hiccup silently loses an invitation.

**Decision:** `docker-compose.ci.yml` becomes the single deployed file. It is
renamed `docker-compose.deploy.yml`, `production.yml` is deleted, and `deploy.sh`
is pointed at the same file the workflow uses. One deployment topology, one file.

## Target runtime

```
Internet :443
    |
    +-- caddy  (new)          automatic Let's Encrypt TLS, self-renewing
         |-- /       -------> frontend  :80    (nginx, unchanged)
         +-- /api/*  -------> backend   :8080

    backend    FrankenPHP     replaces `php artisan serve`
    queue      same image, queue:work --tries=3 --timeout=60
    scheduler  same image, schedule:work
    db         postgres:16-alpine (unchanged)
```

### Backend image

Replace the `php:8.4-cli` + `artisan serve` runtime with `dunglas/frankenphp`.
FrankenPHP is an HTTP server and PHP runtime in one binary, so it swaps in
without introducing an fpm socket and a second nginx to configure. The container
contract is unchanged: it still listens on a port.

The `CMD` also currently runs `php artisan migrate --force` on every container
start. That moves out (see Data safety), leaving the image with one job: serve.

Rejected alternative: nginx + php-fpm. More conventional and better documented,
but it adds a container plus a fastcgi config that has to know Laravel's
`public/` layout, for no benefit at this size. Revisit if FrankenPHP proves
awkward.

### Edge

A `caddy` container terminates TLS and routes `/` to the frontend container and
`/api/*` to the backend. Caddy obtains and renews Let's Encrypt certificates
with no cron and no certbot. The domain is supplied as `APP_DOMAIN` in
`deploy/lightsail/.env` and referenced by the `Caddyfile`.

The frontend nginx container stays exactly as it is — it serves static assets
behind Caddy and needs no change.

## Pipeline

```
push to main
    |
    +-- 1. TESTS (gate)
    |      phpunit vs .github/baselines/phpunit.txt
    |      vitest  vs .github/baselines/vitest.txt
    |      fail -> stop. Nothing is built or deployed.
    |
    +-- 2. BUILD
    |      GHCR images tagged :<sha> and :main
    |
    +-- 3. DEPLOY over SSH
           a. record running SHA -> .deployed-sha
           b. pg_dump backup
           c. compose pull
           d. migrate (one-off container)
           e. compose up -d
           f. health gate: poll /api/health, 60s budget
           g. on failure: restore previous SHA, up -d, exit 1
```

### Gating

`tests.yml` gains a `workflow_call` trigger alongside its existing `push` and
`pull_request` triggers. `deploy-lightsail.yml` declares the test workflow as a
`needs:` dependency rather than duplicating the test configuration. One
definition of "the tests pass", used by both PRs and deploys.

Baseline semantics are unchanged: both suites carry pre-existing failures and
are gated on *new* failing test names, not counts.

### Health gate and rollback

After `up -d`, poll `https://$APP_DOMAIN/api/health` every 3s for up to 60s.
A 2xx within the budget completes the deploy. Otherwise the previous SHA is read
back from `.deployed-sha`, re-pulled, brought up, and the job exits non-zero.

`.deployed-sha` is written only after a successful health check, so it always
names a revision that was observed healthy — never merely one that was attempted.

## Data safety

Migrations move out of the image `CMD` into an explicit deploy step:

```
docker compose run --rm backend php artisan migrate --force
```

They then run exactly once per deploy instead of on every container restart.
Immediately before, `pg_dump` writes a timestamped dump to
`/var/backups/carevance/`, retained 7 days. A failed migration therefore has a
restore point taken minutes earlier, not from the previous night.

Rollback deliberately covers **application code only**. Reverting a migration
automatically is not safe in general — a down-migration that drops a column
destroys data written since the deploy. If a migration is the problem, the dump
is the recovery path and a human decides.

## Runtime version alignment

`tests.yml` runs PHP **8.2**; `backend/Dockerfile` runs PHP **8.4**. The suite
therefore validates a runtime that is never shipped. CI moves to 8.4 to match.

## Out of scope

Deliberately excluded, so the pipeline stays legible:

- **ECS/Fargate migration.** The right answer at scale; premature now. SHA-tagged
  GHCR images are already the input ECS would consume, so this is a migration
  later, not a rewrite.
- **Zero-downtime deploys.** `up -d` causes a brief interruption. Not worth
  blue/green complexity for internal testing.
- **Secrets management.** `.env` stays on the server, managed by hand. Moving to
  SSM/Secrets Manager is worthwhile but independent of this work.
- **Image scanning / SBOM.** Worth adding; not on the critical path to safe
  internal testing.
- **Automatic migration rollback.** See Data safety.

## Verification

The work is done when all of these hold:

1. `curl -I https://$APP_DOMAIN` returns 200 over a valid certificate.
2. `docker compose ps` shows `caddy`, `backend`, `queue`, `scheduler`, `db`,
   `frontend` all up; `backend` runs FrankenPHP, not `artisan serve`.
3. A commit with a deliberately failing new test does **not** deploy.
4. A deploy whose health check fails leaves the *previous* image running, and
   the job exits non-zero.
5. `php artisan tinker --execute="echo config('queue.default');"` prints
   `database` in the backend container.
6. Sending an invitation produces a `Processing:` line in `docker compose logs queue`.
7. `/var/backups/carevance/` contains a dump newer than the last deploy.
8. Concurrent requests are served concurrently — two simultaneous slow requests
   do not serialise.
