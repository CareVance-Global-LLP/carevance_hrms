# Security & Governance Remediation — B-01 through B-11

**Date:** 2026-08-19
**Status:** Approved, in implementation
**Origin:** Buyer diligence report, blocking findings B-01..B-11

---

## Problem

A prospective enterprise customer ran technical diligence on CareVance and declined to
sign. The product's domain core scored well — the statutory engine, tenant isolation and
disbursement honesty were all called best-in-class. It failed on the layer beneath:
authentication, data protection, access governance, operations and extensibility.

Eleven findings block the signature. They are not feature gaps; each fails a specific
procurement gate (InfoSec questionnaire, DPDP Act 2023, the DPA, cyber-insurance controls,
statutory audit, integration review).

## Governing principle

> **Enforce at the framework seam, never at the call site.**

B-07 exists because auditing was a line a developer had to remember to write, and 72 of 80
controllers did not. Permissions, encryption and consent all have the same failure mode
available to them. Every fix below is therefore placed where the framework runs it
automatically:

| Concern     | Seam                                              |
|-------------|---------------------------------------------------|
| Audit       | Eloquent observer bound by an `Auditable` trait   |
| Encryption  | Attribute cast + `saving` hook maintaining a blind index |
| Permissions | Policies + a `permission:` route middleware       |
| Consent     | A single choke point in the monitoring ingestion service |

A fix that depends on future developers remembering something is not a fix.

## Scope decisions

Taken with the product owner on 2026-08-19:

- **Infrastructure (B-05/B-06):** deliver repo code, config and a runbook. Provisioning on
  AWS stays with the customer. Everything must no-op safely when unprovisioned.
- **Integrations (B-09):** API keys and outbound webhooks only. Biometric device drivers
  and accounting exports are deferred — neither can be verified without hardware or a real
  target ledger, and shipping unverified protocol code into payroll is worse than shipping
  nothing.
- **Delivery:** one branch per group, sequenced, each independently reviewable.
- **MFA rollout:** grace period then enforced. Cannot lock out a live tenant on deploy day.
- **Encryption backfill:** two-phase and self-verifying. Assume no safe production copy.
- **RBAC migration:** seed equivalents so no existing user's access changes on deploy.
  Maker-checker ships behind an org setting, default off.

## Correction to the diligence report

The report understated two things, and the design reflects the corrected picture:

1. **B-08 is finishing a system, not building one.** `RoleService`, a `custom_role`
   relation and a `role_permissions` pivot already exist, and `User::getHierarchyLevel()`
   honours `customRole?->hierarchy_level` before falling back to a string ladder that has
   five rungs (`super_admin` 0, `admin` 10, `hr`/`payroll_manager` 20, `manager` 50,
   `employee` 100), not four.
2. **Sanctum is deliberately absent.** `AuthenticateApiToken` owns the
   `personal_access_tokens` table with hand-rolled sha256 token hashing. B-04 will be fixed
   by completing that design, not by installing Sanctum — two competing auth stacks in a
   payroll system is a worse outcome than the bug.

---

## Group E — Filing honesty (B-10)

**Gate failed:** truth in the demo.

Ten of thirteen statutory filing generators reference blade views that were never written.
Only `form12ba`, `form16` and `form16_annual` exist under `resources/views/filings/`.

**Design.** A `FilingGeneratorRegistry` is the single authority on which filings exist. It
resolves availability by asking the filesystem whether the generator's view is present,
rather than carrying a hand-maintained list that will drift. The API returns
`available: false` with a machine-readable reason; the UI stops offering unavailable
filings instead of failing after the user clicks.

**Why filesystem-resolved:** the test asserting registry availability against the view
directory keeps passing unchanged as the ten missing templates get written. A hardcoded
list would need editing ten more times, and would be wrong in between.

## Group C — Access governance (B-03, B-04, B-07)

**Gates failed:** DPA clause 6 (processor access logged, time-boxed, controller-approved);
statutory audit (immutable actor trail on payroll and disbursement).

### B-04 — token minting

`User` has no `createToken`, so `SuperAdminController::impersonate` throws a fatal error on
every call. An `IssuesAccessTokens` trait provides minting against the existing
`personal_access_tokens` schema — name, sha256 hash, abilities, `expires_at` — matching
exactly what `AuthenticateApiToken` already reads.

### B-03 — break-glass access

Replace unlogged, unlimited impersonation with a governed session.

`BreakGlassSession`: requesting vendor user, target organisation, target user, **mandatory
reason**, requested_at, approving customer admin, expires_at (hard ceiling 60 minutes),
revoked_at.

- A token is minted only against an approved, unexpired session, carrying the ability
  `impersonate:{session_id}`.
- Middleware resolves the session and stamps its id on the request.
- The audit observer records that id on every write, so the trail reads *"changed under
  break-glass session 41 by vendor user X, reason: …"* — not merely *"changed"*.
- The tenant owner is emailed at grant.

### B-07 — audit by observer

An `Auditable` trait binds `AuditObserver`, which writes through the existing
`AuditLogService` (already competent: sanitises sensitive keys, records actor/IP/UA, fails
soft). Applied to every model touching money or identity — payroll runs and items,
disbursement batches and transfer items, filings, roles and permissions, exits and
settlements, performance reviews, assets, bank accounts and government IDs.

Controllers get no new audit lines. That is the point.

## Group A — Identity and access (B-01, B-08)

**Gates failed:** InfoSec Q14 (mandatory MFA on administrative access); segregation of
duties / maker-checker on disbursement.

### B-01 — MFA

TOTP via a pinned, audited library. `user_mfa_secrets` (encrypted secret, `confirmed_at`)
and `user_recovery_codes` (hashed, single-use).

Login with MFA enrolled returns `mfa_required` plus a short-lived challenge token rather
than a session; `POST /auth/mfa/verify` completes authentication. Organisation setting
`mfa_policy` ∈ `off | grace | enforced`, with `mfa_grace_ends_at` defaulting to 14 days.
Middleware `mfa.enforced` guards privileged routes.

Enrolment is available to everyone immediately; enforcement bites only for `admin`, `hr`
and `payroll_manager` after the grace window, and the org owner may enforce sooner.

### B-08 — granular permissions

Seed the permission catalogue. A migration grants each existing role precisely the
permissions matching its current capability, so **no user's access changes on deploy**.
Laravel policies for Payroll, Disbursement, Employee, Filing and Role; a `permission:`
route middleware for the greppable cases.

Maker-checker: organisation setting `payroll_maker_checker`, default **off**. When on, the
approver of a payroll run must differ from its creator, and the disburser must differ from
the approver.

## Group B — Encryption at rest (B-02)

**Gates failed:** DPDP Act 2023 §8(5) reasonable security safeguards; cyber-insurance
controls schedule.

Account numbers, IFSC, UPI ID, PAN, Aadhaar, UAN and ESI numbers are stored plaintext. No
model uses an encrypted cast.

**The complication.** Thirteen sites filter, compare, upper-case or de-duplicate on these
exact columns:

```
PayrollReadinessService.php:108    whereRaw('UPPER(pan_number) = ?', [$normalised])
PayrollReadinessService.php:111    whereRaw('UPPER(TRIM(id_number)) = ?', [$normalised])
PayrollDashboardController.php     whereNull / whereNotNull / != '' on pan_number
PayrollDashboardController.php:463 whereNotNull('employee_bank_accounts.account_number')
PayrollDepartmentController.php    account_number + ifsc_swift presence checks
PayrollFilingController.php:205    where('pan_number', $pan)
EmployeeWorkspaceService.php:371   where('account_number', $accountNumber)
PayrollValidationService.php:153   whereNotNull + != '' on pan_number
```

A cast alone turns each column into ciphertext and every one of these silently changes
meaning — `whereNotNull` starts returning true for everybody, exact-match lookups stop
matching, and duplicate detection stops detecting.

**Design.**

- `EncryptedAttribute` cast for the value.
- `BlindIndexed` trait maintains `<column>_bidx` = HMAC-SHA256 of the **normalised**
  (trimmed, upper-cased) value on `saving`. Deterministic, so equality and presence queries
  work; keyed, so the index is not a rainbow-table of PANs.
- Rewrite the thirteen sites against `_bidx`. Duplicate-PAN detection becomes a group-by on
  the blind index, which also finally makes the known dirty data (15 employees with two PAN
  rows of different values) queryable rather than anecdotal.
- Key in a dedicated `FIELD_ENCRYPTION_KEY`, **not** `APP_KEY` — rotating the application
  key must never orphan employee PII. Ciphertext carries a key-version prefix for rotation.

**Two-phase migration.**

1. Add ciphertext and `_bidx` columns beside the originals; backfill; leave plaintext intact.
2. `php artisan pii:verify-encryption` decrypts every row and asserts equality against the
   retained plaintext, reporting any mismatch by table, row id and column.
3. A **separate** migration drops the plaintext columns, run only once step 2 is clean.

Fully reversible until step 3. This is the riskiest group and is sequenced fourth so that
the audit trail from Group C is already recording before any PII column is touched.

## Group D — Monitoring consent (B-11)

**Gate failed:** DPDP Act 2023 notice-and-consent; works-council surveillance commitments.

The platform captures screenshots, application and URL activity, GPS-geofenced punches and
attendance selfies with no consent capture, no disclosure record and no per-employee
opt-in. A comment in `TrackerPolicyResolver` observes that a resolved policy "is the one a
DPDP notice can actually point at" — the notice does not exist.

**Design.**

- `MonitoringNotice`: versioned text, stated purpose per capture type, retention period.
- `MonitoringConsent`: per employee per capture type — notice version acknowledged,
  granted_at, withdrawn_at, IP.
- **Choke point:** ingestion for each capture type refuses with 403 and a machine-readable
  reason when no active consent covers it. One function, not four scattered checks.
- Employee-facing screen: what is collected, why, for how long, and a withdraw control.
- Organisation-level kill switch.

Notably this converts the platform's largest compliance liability into a differentiator —
consent-first workforce verification is defensible in a way that silent capture is not.

## Group F — Platform operations (B-05, B-06)

**Gates failed:** stated RPO/RTO; load test at 3× contracted seats.

Production is one Lightsail instance running Postgres, API, queue, scheduler, frontend and
Caddy. No replica, no object storage, no load balancer. Backup exists as a line of advice
printed by `deploy.sh`. `CACHE_STORE`, `QUEUE_CONNECTION` and `SESSION_DRIVER` are all
`database`, so every cache read and queue poll is a write to the same Postgres computing
payroll. No APM of any kind.

**Design.** Everything must no-op safely when unprovisioned, since the customer does the
provisioning.

- Redis service in the compose stack; cache/session/queue move to Redis, **falling back to
  database when `REDIS_HOST` is unset** so no existing deployment breaks.
- `backup.sh` — pg_dump, gzip, S3 upload when `AWS_BUCKET` is set (local otherwise),
  retention policy.
- `restore-verify.sh` — restores the latest backup into a throwaway container and asserts
  row counts and payroll checksums. A backup nobody has restored is not a backup.
- S3 disk for screenshots and documents, activated by `AWS_BUCKET`.
- `/api/health` extended: queue depth, oldest pending job age, last scheduler run, failed
  job count. `/api/health/simple` stays untouched as liveness.
- Sentry and OpenTelemetry behind env vars, no-op when unset.
- `deploy/lightsail/RUNBOOK.md` naming exactly what to provision and click.

## Group G — Integrations (B-09, reduced)

**Gate failed:** integration architecture review.

No public API, no customer API keys, no outbound webhooks. The only webhook is inbound from
Razorpay for the vendor's own billing.

**Design.**

- `api_clients`: organisation-scoped, name, key hash, scopes, expires_at, last_used_at.
  `AuthenticateApiClient` middleware alongside the existing user-token middleware.
- `webhook_endpoints` + `webhook_deliveries`: HMAC-signed payloads, retry with exponential
  backoff, dead-letter visible in the UI.
- Events: `employee.created`, `employee.updated`, `employee.exited`,
  `payroll.run.approved`, `payroll.run.disbursed`, `leave.approved`,
  `attendance.regularised`, `invoice.paid`.

Deferred with reasons stated: biometric device ingestion (eSSL/ZKTeco/Matrix) needs
hardware to verify; Tally and Zoho Books journal export needs a real target ledger.

---

## Testing strategy

Applies to every group, per the project's existing discipline:

- TDD — failing test first.
- Failing test **names** diffed against `.github/baselines/phpunit.txt` and `vitest.txt`
  via `scripts/ci/test-baseline.mjs`. Never counts.
- `npx tsc --noEmit` stays at 0.
- `TenantIsolationTest` and `TenantScopeFailsClosedTest` stay green through every group —
  several of these changes add models, and any model owning an `organization_id` table must
  carry `BelongsToOrganization`.
- New models added in Groups C, D and G are tenant-scoped and will be caught by that test
  if they are not.

## Sequence

```
E  →  C  →  A  →  B  →  D  →  F  →  G
```

E first because it is small and proves the delivery pipeline. C before B so the audit trail
is recording before any PII column is touched. B fourth because it is the only group that
can destroy data. G last because it is additive and blocks nothing.

## Risks

| Risk | Mitigation |
|---|---|
| Encryption backfill corrupts PII | Two-phase, verify command, plaintext retained until a separate opt-in migration |
| MFA locks out a tenant's only owner | Grace window, recovery codes, enforcement limited to privileged roles |
| Permission seeding changes someone's access | Migration seeds exact current-capability equivalents; maker-checker default off |
| Redis switch breaks an unprovisioned deployment | Falls back to database when `REDIS_HOST` unset |
| Break-glass rewrite locks out vendor support | Approval flow ships with the endpoint; the current endpoint is dead code (500s), so there is no working behaviour to preserve |
