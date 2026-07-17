# Auto E-Filing for Statutory Returns — CareVance (Keka-style Semi-Auto)

## Context & Decision

The user wants "auto e-filing like Keka." Research shows the real constraints:

- **EPFO ECR** and **ESIC monthly contribution**: **NO official public filing APIs.** Filing requires a logged-in browser session + manual `.txt`/Excel upload on the employer portal. True unattended submission would require brittle RPA/browser-automation (against portal ToS) — explicitly out of scope.
- **TDS (Form 24Q) + Form 16 certs**: Only domain with commercial e-filing APIs, via paid aggregators (Sandbox/Quicko, ClearTax) acting as TIN-FC. Deferred to a later phase; not built now.
- **PT / LWF**: State-portal uploads; no uniform API. Semi-auto only.
- **Keka's actual model** = generate correct file → internal validation → one-click upload/pre-fill → human logs in + pays → records acknowledgement. That is exactly what we will implement.

**Confirmed decisions:**
1. **Keka-style semi-auto**: system prepares the correct portal-format file, validates it, and gives a one-click "Upload to portal" that opens/pre-fills the government portal or downloads the exact file. Human does login + payment. Covers all 8 types now; TDS API is a later, optional upgrade.
2. **Manual ack + proof**: after the human files, they paste the portal acknowledgement/challan number. Stored in the already-existing `acknowledgment_number` + `filed_by` + `filed_at` columns. No portal-credential vault.

This is consistent with the prior brief's non-goal ("do NOT attempt to build actual government portal API integrations — every filing type remains 'generate locally, then the human files it'").

## Current-state gaps (from code review)

- `PayrollFilingService.php` generators now produce correct/format-honest files (PF ECR, Form 16 Part B PDF, Form 12BA PDF, Form 24Q source-data, ESI/PT summaries, LWF per-state, Bonus Form C). See prior fixes.
- `PayrollFiling` model already has `status` (`draft,generated,filed,acknowledged,error`), `acknowledgment_number`, `filed_by`, `filed_at`, `meta_data`. These are **unused** by any endpoint/UI today.
- `PayrollSettingsController` already stores `statutory.tan/pan/esiCode/ptRegNumber/lwfRegNumber` and `compliance_due_dates` in `org->settings['payroll']`. These are the portal identifiers we surface.
- `ApprovalRoutingService` exists for maker-checker routing (reuse for the internal "submit for review" gate).
- Frontend `FilingsDashboard.tsx` already has `complianceStatus` badges. We extend it with upload links, validation, and a "Mark Filed" flow.

## Implementation Plan

### Phase A — Portal-format correctness (prerequisite, mostly done; finish gaps)

1. **PF ECR**: current generator uses space/comma-ish delimiter. EPFO revamped ECR is **tab/`||` delimited, 11-column** format (UAN, Name, Gross, EPF Wages, EPS Wages, EDLI Wages, EPF EE, EPS ER, EPF Diff ER, NCP Days, Refund). Update `generatePfEcr` to emit the exact 11-col `||`-delimited spec (matches EPFO upload), add `ncp_days` (from `PayrollItem`) and EDLI/ER-split columns. Keep PF ₹15k cap.
2. **ESI**: produce the **ESIC portal-compatible Excel/CSV** (employer code, IP number, name, days, wages, EE/ER contribution) instead of a plain summary. Add a `.csv` export matching ESIC "Upload Excel" format. Keep the human-readable summary as a secondary download.
3. **PT / LWF**: keep per-state summary; add a state-portal-specific note/link per state in `meta_data` (which portal + form number, e.g. Maharashtra Form III/V).
4. **Form 24Q**: keep as source-data; in Phase C wire to Sandbox/Quicko FVU+e-file as an *optional* toggle (not required for this plan's core).

### Phase B — Pre-flight validation (`FilingValidatorService`)

Reuse the `PayrollChecklistService` pattern. New service `app/Services/PayrollFilingValidatorService.php`:

- `validate(PayrollMonthlyRun $run, string $type, array $context): ValidationResult` returning `{ ready: bool, errors: [], warnings: [] }`.
- Checks per type:
  - **PF ECR**: every item has active `uan_number`; EPF wages ≤ ₹15k cap; zero-gross skipped; employer PF code present in `statutory`.
  - **ESI**: every covered item (gross ≤ ₹21k) has `esi_ip_number`; employer `esiCode` present.
  - **TDS/Form 16**: every item has `pan_number`; TAN present; aggregate TDS > 0 sanity.
  - **PT**: employees in state have `pt_state`; PT reg number present.
  - **LWF**: state configured in `LWF_STATE_CONFIG`; `lwf_enabled` employees exist.
  - **Bonus**: `bonusPercent` in 8.33–20; employees ≤ ₹21k basic.
- Expose `POST /payroll/filings/validate` returning the report so the UI can show a green/red "Ready to file" checklist before generation.

### Phase C — Internal submit-for-review + filed workflow

1. Extend `PayrollFiling` flow: `generated → submitted → approved → filed → acknowledged`.
   - Add migration: `submitted_at`, `submitted_by`, `approved_at`, `approved_by`, `review_note` (text), `portal_status` (enum: pending_upload, uploaded, paid, error). `status` gains `submitted`/`approved`.
2. Endpoints in `PayrollFilingController`:
   - `POST /filings/{id}/submit` → sets `submitted`, routes reviewer via `ApprovalRoutingService` (same as payroll runs).
   - `POST /filings/{id}/approve` and `/reject` (reviewer) → `approved` / back to `generated` with `review_note`.
   - `POST /filings/{id}/mark-filed` → body `{ acknowledgment_number, portal_status? }` sets `filed_by`, `filed_at`, `acknowledgment_number`, `status='filed'`. Uses existing columns.
3. Wire into `generateAllFilings` so generated filings auto-enter `submitted` to the reviewer.

### Phase D — One-click "Upload to portal" + due-date awareness (the semi-auto UX)

1. New `PortalAdapter` per type returning `{ url, instructions, prefill? }`:
   - PF ECR → `https://unifiedportal-emp.epfindia.gov.in` ECR Upload deep link + "upload this .txt" instruction.
   - ESI → `https://portal.esic.gov.in` Monthly Contribution upload + instruction.
   - TDS → if Sandbox configured: POST to aggregator (Phase C optional); else TRACES/RPU instruction.
   - PT/LWF → state portal URL from a `STATE_PORTAL` map (state → URL + form no).
   - Form 16 → TRACES Part A download instruction.
2. Frontend `FilingsDashboard.tsx`:
   - Each card gets an **"Upload to portal"** button (opens adapter URL in new tab; for ESIC/PT also offers the exact download). Disabled until validation passes + reviewer approved.
   - **"Mark Filed"** button → modal to paste challan/ack number; on save, status → `filed` with the number shown in History.
   - **Compliance calendar strip** from `compliance_due_dates`: "PF ECR Jun — due 15 Jul" with overdue highlight.
   - Reviewer queue tab: "Pending your review" lists `submitted` filings with Approve/Reject.

### Phase E — Safety & honesty guards (carry from prior brief)

- Generation blocked unless run is `approved`/`locked`.
- A generated filing with no `file_path` still surfaces as error (already implemented).
- Never auto-submit to a government portal; the human always performs login + payment. TDS aggregator (if later enabled) requires explicit opt-in + stored API key in `org->settings`, never portal passwords.

## Affected files / boundaries

- **Backend**: `PayrollFilingService.php` (ECR 11-col, ESI csv, portal meta), new `PayrollFilingValidatorService.php`, `PayrollFilingController.php` (+3 endpoints), `PayrollFiling` model + migration, `routes/api/protected/payroll_filings.php`, new `Services/PortalAdapter.php` + `config/portal_adapters.php` (URL map), `PayrollSettingsController` (optional: store TDS aggregator API key).
- **Frontend**: `FilingsDashboard.tsx` (validation banner, upload button, mark-filed modal, reviewer queue, calendar strip), `api.ts` (new endpoints), optional new `FilingReviewQueue.tsx`.
- **No** government API integration, no credential vault, no RPA.

## Validation / done criteria

- [ ] PF ECR file passes EPFO format (11 cols, `||` delimited) when uploaded to sandbox/manual validator.
- [ ] ESI export matches ESIC "Upload Excel" columns.
- [ ] Validation report blocks generation when UAN/PAN/PT-state missing; shows actionable list.
- [ ] Reviewer can approve/reject a submitted filing; rejected returns to `generated`.
- [ ] "Upload to portal" opens correct portal + provides exact file; disabled until approved.
- [ ] "Mark Filed" records ack number in History; status → `filed`.
- [ ] Compliance calendar shows upcoming/overdue filings from `compliance_due_dates`.
- [ ] No filing can be generated from a non-approved run.

## Open questions (not blocking)

- Exact ESIC Excel column order (confirm against current ESIC portal template before Phase A.2).
- Which states the org actually operates in (trim `LWF_STATE_CONFIG` + `STATE_PORTAL` to those).
- Whether to later enable the paid TDS aggregator (Sandbox/Quicko) — separate, opt-in phase.
