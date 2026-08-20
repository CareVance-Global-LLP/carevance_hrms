# MFA handoff brief

Findings from a codebase audit and competitor research run on 19 Aug 2026, for
whoever is building MFA. Every file:line below was verified, not inferred.

---

## 1. STOP — two things will break production today

**The migration has not been run.** `EnsureMfaEnrolled` is wired into
`AuthenticateApiToken`, so with `2026_08_19_000020_create_mfa_tables.php`
unapplied, **every authenticated request 500s** with
`SQLSTATE[42P01]: Undefined table`. This was hit on a local machine and took the
whole app down until the migration was run.

This is the same failure that cost a full day on the production server on
19 Aug: code deployed, migration not run, 27 tables silently absent.

**The default policy is `grace`, which locks everyone out.**
`MfaService::policyFor()` returns `'grace'` when
`organizations.settings.security.mfa_policy` is unset:

```php
return in_array($policy, ['off', 'grace', 'enforced'], true) ? $policy : 'grace';
```

On a server where nobody is enrolled, that means **every user is blocked at
once** the moment the code lands. The default must be `'off'`. An org opts in;
it does not opt out.

---

## 2. Four ways to bypass MFA entirely

There is exactly **one** password check in the whole system
(`AuthController.php:186`) and **one** token mint
(`ApiTokenService::issue`, 29 lines). But five call sites mint tokens, and four
of them never touch the login path:

| Site | Problem |
|---|---|
| `OAuthController.php:135` | Google sign-in. Resolves an existing password account by email at `:94` with an **unscoped** `User::where('email',$email)->first()`, then mints a full token. Never checks `$decoded->email_verified`. Anyone with MFA on their password login skips it by clicking "Sign in with Google". |
| `OAuthController.php:362` | `completeRegistration` mints a second live token without revoking the first. |
| `AuthController.php:406` | `handoff` mints a brand-new full-TTL token from any presented token, with zero re-verification. |
| `AuthController.php:436` | `issueDesktopToken`, same. Also puts a bearer token in a **URL query string** (`Layout.tsx:113-123`). |

Note the unscoped email lookup at `OAuthController.php:94` is the same shape as
the legacy `invites` bug CLAUDE.md describes as a cross-tenant password
overwrite. Worth fixing on its own merits, MFA or not.

---

## 3. Three prerequisites that do not exist yet

**No way to express "password OK, MFA pending".** `ApiTokenService.php:20`
writes `abilities => ['*']` and `AuthenticateApiToken.php:23-33` **never reads
it**. A half-authenticated session has nowhere to live in the current token
model. Decide this before writing the challenge flow.

**No encryption at rest, anywhere.** A grep for `Crypt::`, `encrypt(`, and
`'encrypted'` across `backend/app` and `backend/config` returns nothing. A TOTP
secret would be this codebase's **first** encrypted column, so the convention
has to be established rather than followed.

**No multi-session revocation.** `AuthController.php:329` (logout) deletes only
the presented token. `SettingsController.php:232-234` (password change) and
`PasswordResetController.php:40-52` (password reset) revoke **nothing** — the
reset rotates `remember_token`, which `AuthenticateApiToken` never reads. So:

- a stolen token survives the victim changing their password
- "sign out everywhere after enabling MFA" has nothing to call

`ApiTokenService` is where a `revokeAllExcept($user, $currentTokenId)` belongs.

---

## 4. Two traps that will waste your time

**`AuthController::clearLoginRateLimits` (:559-574) is dead code.** It calls
`RateLimiter::clear()` with the raw key, while `ThrottleRequests` stores under
`md5($limiterName . $key)`. It has never worked — a successful login does not
reset the failure counter. **Do not copy this helper for an MFA verify step.**

**`TestCase.php:17,:52` mints a fully-privileged token for every `actingAs()`
call without going through login.** Put enforcement inside
`AuthenticateApiToken` and **several hundred tests break at once**. This pushes
enforcement toward the login path rather than the middleware. It is a design
constraint, not a detail.

---

## 5. Rate limiting

`AppServiceProvider.php:81-194` defines 17 named limiters. Two constraints:

- Buckets key on the limiter **name**, so `/auth/login` and `/auth/check-email`
  already share one budget. **Do not reuse `auth.login`** for code verification.
- A 6-digit code is 1,000,000 combinations. It needs its own limiter or it is
  trivially brute-forceable.
- The desktop UA fork (electron → 12/min vs 5/min) is load-bearing, because the
  Electron shell embeds the same login page.

---

## 6. What to copy rather than invent

The **email-verification gate** at `AuthController.php:192-199` is an exact
structural precedent for a challenge response:

```php
return response()->json([
    'success' => false,
    'message' => '...',
    'error_code' => 'EMAIL_NOT_VERIFIED',
    'email' => $user->email,
], 403);
```

`Login.tsx:129` **already branches on `error_code`**. Use 403 with an
`error_code`, not 401 — 401 is a terminal logout on all three clients.

Also reusable as-is: audit logging with recursive secret redaction
(`AuditLogService.php:16-34`), org-policy-in-JSON with a resolver service
(`TrackerPolicyResolver` is the pattern), and `BelongsToOrganization` scoping.

The Electron shell has **no login of its own** — it loads the web SPA
(`desktop/main.cjs:70, :1295`) — so a self-hosted challenge screen ships to
desktop for free.

---

## 7. The offline problem, and what the industry actually does

`desktop/offline/offline-db.cjs:543` + `AuthContext.tsx:318-344` restore a full
session **offline for 30 days with no credential check whatsoever**. That is
already a trusted-device bypass any MFA policy must answer for.

Researched from vendor documentation (19 Aug 2026):

- **The category avoids this collision entirely.** Time Doctor's Automatic App,
  Hubstaff's Silent App and ActivTrak's agent have **no user login at all** —
  identity comes from the OS account, tenancy from a per-org installer or a
  per-instance key. MFA governs the **web console**, not the agent.
- **Hubstaff** is the only vendor documenting org-wide enforcement, with a
  **24-hour grace period** to enrol. Good precedent for the rollout.
- **Time Doctor**: an expired token stops **sync**, never **capture** — worth
  copying, because it protects the user's pay.
- Nobody in the tracker category publishes an offline auth policy. The real
  numbers come from identity vendors: **Okta Device Access defaults to 168
  hours (7 days)**; **Cisco Duo** allows a longer window but **resets the budget
  on the next successful online auth**.

Your 30 days is ~4× Okta's most permissive default, and unlike Duo, Okta,
Windows Hello or 1Password it asks the human for **nothing** at unlock.

**Suggested policy:** MFA gates interactive login only. Offline degrades sync,
not capture. Cut the offline window 30 → 7 days, resetting on every successful
online auth. Require something local at unlock, even a PIN — that is the actual
gap, not the duration.

---

## 8. Decisions already taken

- **Scope:** off by default; an org admin can enforce for everyone; individuals
  may opt in. (Matches Hubstaff, and it is what enterprise security
  questionnaires actually ask for.)
- **Factor:** TOTP authenticator app + one-time recovery codes. Deliberately no
  email or SMS: email codes depend on queued mail, which was silently broken on
  the production server for months, and that failure mode locks people out.

---

## 9. Before this reaches the server

1. Run the migration **in the same deploy** as the code.
2. Default `mfa_policy` to `'off'`.
3. Close the four bypass mint sites, or MFA is decorative.
4. Add `revokeAllExcept` and call it on password change and reset.
5. Give the verify endpoint its own rate limiter.
6. Decide the offline story before the desktop build ships.
