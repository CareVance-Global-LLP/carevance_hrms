# Fix Statutory Filing Generators — Backend Accuracy + Frontend Honesty

## Goal
Make each of the 8 statutory filing generators in `PayrollFilingService.php` either
produce a correct/complete artifact or honestly represent what it is, and update
`FilingsDashboard.tsx` so it stops presenting every filing type as equally
filing-ready. No government portal API integration (all filings remain
"generate locally, human files it").

## Affected files
- `backend/app/Services/PayrollFilingService.php` (primary)
- `backend/app/Services/PayrollPdfService.php` (add generic PDF renderer)
- `backend/app/Http/Controllers/Api/PayrollFilingController.php` (Bonus Form C wiring; error surfacing)
- `backend/app/Services/PayrollAutoProcessService.php` (`autoGenerateFilings` — keep in sync)
- `backend/routes/api/protected/payroll_filings.php` (Bonus Form C route)
- `backend/resources/views/filings/form16_annual.blade.php` (edit: remove cert no, Part A/B split)
- `backend/resources/views/filings/form_12ba.blade.php` (new)
- `backend/resources/views/filings/bonus_form_c.blade.php` (optional new; can stay text)
- `backend/config/payroll_lwf.php` (new — per-state LWF rate table) OR inline table constant
- `frontend/src/components/payroll/FilingsDashboard.tsx` (compliance-status field, badges, error handling)
- `frontend/src/components/payroll/HowItWorksCard.tsx` (no change to component; only its props usage)
- `frontend/src/services/api.ts` (add `generateBonusFormC`)

## Confirmed facts from code inspection
- PF ECR (2.1) is correct — DO NOT TOUCH.
- `generateBonusFormC` exists in the service but is NOT wired to any route,
  controller, `api.ts`, `generateAllFilings`, or `autoGenerateFilings`. It is
  currently dead code.
- `generateForm12BA` never writes a file (no `file_path`/`original_filename`).
- Form 16 saves `.html` via `Storage::disk('local')->put`, injects a fabricated
  `certificateNo`. A Blade view (`form16_annual.blade.php`) already exists.
- `PayrollPdfService` uses Dompdf but only exposes `generatePayslip(PayrollItem)`.
- Frontend download hardcodes `new Blob([...], { type: 'text/html' })` (line 117)
  — wrong for PDF/txt/xml. Must derive from response content-type / filename.
- `generateAllFilings` (service) and `autoGenerateFilings`
  (`PayrollAutoProcessService`) BOTH enumerate the generators — any signature
  change (e.g. LWF `$state`) must be updated in both.
- `PayrollFiling` records support `status` including `error` (frontend already
  styles `error`).

## Decisions (from user)
- **LWF (2.6):** Build a full per-state table covering ALL Indian states.
  States that have an LWF Act get correct amount + periodicity + wage slab.
  States with NO LWF Act are marked `not_applicable` (not "not configured").
  Add `$state` param. Until a state's row is verified, that state gates as
  `not_configured` in UI and the generator refuses to emit a number.
- **Form 24Q (2.3):** Match Keka's real behavior. Baseline deliverable =
  relabel as "Form 24Q (working data / source export)" with
  `complianceStatus: 'source_data_only'` + guidance that real filing needs
  NSDL RPU/FVU + challan/CSI details. Full NSDL FVU fixed-width TXT format is
  a documented DEFERRED follow-up (see Task 5 / Deferred section). Keka itself
  requires manual challan entry (BSR code, challan no, CSI file) before FVU
  generation, which this system does not collect yet.
- **Bonus Form C (2.8):** Fix logic (configurable %, annual wages) AND fully
  wire it up (controller + route + api.ts + FILING_TYPES card).
- **Form 16 / 12BA PDF:** Add a generic `renderPdf(string $view, array $data,
  string $paper = 'A4', string $orientation = 'portrait'): Dompdf` (or
  `renderPdfToStorage(...)`) to `PayrollPdfService` and reuse it.

## Compliance status vocabulary (shared backend/frontend)
- `ready` — matches the real portal upload format (PF ECR only).
- `source_data_only` — export of underlying data; real filing needs external
  software/portal (Form 24Q).
- `reference_summary` — human-readable summary for manual portal entry
  (ESI Challan, PT Return).
- `needs_state_config` / `not_configured` — LWF for a state without a verified rate row.
- `not_applicable` — LWF for a state with no LWF Act.
- `external_step_required` — Form 16 / 12BA (needs TRACES Part A externally).

---

## Task order (matches prompt Section 6, adjusted for confirmed dependencies)

### Task 1 — Form 12BA writes a real file (smallest fix)
1. Add generic PDF renderer to `PayrollPdfService`:
   `renderPdf(string $view, array $data): Dompdf` mirroring `generatePayslip`
   options (`isRemoteEnabled=false`, `defaultFont=DejaVu Sans`).
2. Create `resources/views/filings/form_12ba.blade.php` rendering the existing
   `$entries` array (employee, PAN, gross salary, perquisites, profits in lieu,
   total income, TDS) as a proper Form 12BA statement of perquisites.
3. In `generateForm12BA`: render Blade -> PDF -> `Storage::disk('local')->put`
   at `filings/{$orgId}/form12ba/{$filename}` (`.pdf`), and set `file_path` +
   `original_filename` on the created record (matching every other generator).
4. Keep `meta_data['entries']` as-is.
- **Validation:** generate for a run with perquisite records; confirm a PDF file
  exists on disk and the record has `file_path`/`original_filename`; Download
  button appears and downloads a valid PDF.

### Task 2 — LWF state-aware + gating
1. Add `$state` parameter: `generateLwfReturn(PayrollMonthlyRun $run, string $state, int $orgId, int $userId)`.
2. Create per-state LWF table (`config/payroll_lwf.php` returning an array keyed
   by state slug used in the frontend dropdown). Each entry:
   `{ has_act: bool, employee_contribution, employer_contribution, periodicity:
   'monthly'|'half_yearly'|'annual', wage_slabs?: [...], deduction_months?: [...] }`.
   - States WITH an LWF Act (verify current rates against each state's LWF Act
     before marking verified): Maharashtra, Karnataka, Tamil Nadu, Gujarat,
     West Bengal, Kerala, Delhi, Haryana, Punjab, Madhya Pradesh, Chhattisgarh,
     Andhra Pradesh, Telangana, Goa, Odisha (+ others confirmed to have an Act).
   - States/UTs WITHOUT an LWF Act: mark `has_act: false` -> `not_applicable`.
   - NOTE: the current dropdown includes states that do NOT levy LWF (e.g. UP,
     Bihar, Jharkhand, Assam, Rajasthan). Do NOT invent rates for these —
     mark `not_applicable`.
3. In the generator: look up the state row. If unknown/unverified ->
   throw a typed exception (or return a filing with `status: 'error'` +
   `meta_data.reason`) instead of emitting the old hardcoded 12/36. If
   `has_act: false` -> same "not applicable" outcome. Only emit numbers for
   verified rows, honoring per-state periodicity/slabs.
4. Update BOTH `generateAllFilings` (service) and `autoGenerateFilings`
   (`PayrollAutoProcessService`) to pass a state (loop over configured
   `lwf` states per org, mirroring the PT-state loop) instead of calling the
   old no-arg signature.
5. Update controller `generateLwfReturn` to validate + pass `state`; update
   route + `api.ts` (`generateLwfReturn(runId, state)`).
- **Rate sourcing:** rates MUST come from each state's actual LWF Act, not
  guesses. Any state not yet verified stays `not_configured`. Report which
  states were actually verified vs left unconfigured.
- **Validation:** verified state emits correct amount/periodicity; unverified
  or no-Act state surfaces "not configured"/"not applicable", never a number.

### Task 3 — Frontend compliance-status field, badges, honest help text, error surfacing
1. Replace flat `FILING_TYPES` with objects carrying `complianceStatus` per the
   vocabulary above:
   - `pf_ecr` -> `ready`
   - `esi_challan` -> `reference_summary`
   - `form_24q` -> `source_data_only`, relabel "Form 24Q (working data)"
   - `form_12ba` -> `external_step_required`
   - `pt_return` -> `reference_summary` (needsState)
   - `lwf_return` -> `needs_state_config` (needsState; drive per-state gating
     from a small client-side map or an API field)
   - `bonus_form_c` -> add card (see Task 7)
2. Render a distinct badge per status: green "Filing-ready", amber "Reference
   only — manual portal entry", blue "Source data — needs RPU/portal", grey
   "Not configured", grey "Not applicable", indigo "Needs TRACES step".
3. Add `needsState` gating for LWF (reuse the existing state dropdown pattern);
   disable generate when the selected state is `not_configured`/`not_applicable`.
4. Rewrite `HowItWorksCard` props in `FilingsDashboard`: replace the one-size
   "generate -> upload to portal" `whatIsThis`/`howItFlows` text with
   per-workflow guidance (PF ECR = upload-ready; ESI/PT = reference for manual
   entry; Form 24Q = source data -> NSDL RPU/FVU; Form 16/12BA = needs TRACES
   Part A externally).
5. Fix the download blob type: derive MIME from response headers / filename
   extension instead of hardcoded `text/html`.
6. Error surfacing: any generate mutation whose response indicates no
   `file_path` (or `status === 'error'`) must show an error toast/inline error,
   NOT a success toast. `generateAllFilings` success handler must inspect
   returned filings and flag any with missing `file_path`/`status: error`.
- **Validation:** each type shows its correct badge; LWF for a no-Act state is
  blocked; a filing returned without a file shows an error, not success.

### Task 4 — Form 16 repositioned as Part B + real PDF (pair with 12BA)
1. Remove fabricated `certificateNo`; do not pass it to the view.
2. Edit `form16_annual.blade.php`:
   - Retitle to "Form 16 — Part B (Salary Statement / Annexure)".
   - Remove the "Certificate No" line; clarify Part A (TAN-level TRACES
     certificate) is issued separately from TRACES after 24Q filing.
   - Keep employer/employee/computation/month-wise sections.
3. Render via `PayrollPdfService::renderPdf` and save as `.pdf` (not `.html`);
   set `file_path`/`original_filename` accordingly.
4. Add an optional Part A upload path (admin uploads TRACES-downloaded Part A;
   stored alongside Part B; referenced in `meta_data`). If Part A upload UI is
   larger than this pass, document it as a scoped follow-up but still relabel
   the generated artifact as Part B so it is not misrepresented as a full Form 16.
5. Frontend Form 16 tab copy updated to say "Part B" + note Part A comes from
   TRACES.
- **Validation:** generated file is a valid PDF, no fabricated cert number,
  labeled Part B.

### Task 5 — Form 24Q relabel now; full FVU format deferred
1. Baseline (this pass): keep the data export but relabel filing type display
   as "Form 24Q (working data)"; frontend `complianceStatus: 'source_data_only'`
   with tooltip: actual e-TDS return must be prepared via NSDL RPU + validated
   through FVU (needs challan BSR/number/date + CSI file) before uploading to
   the income-tax portal.
2. Optionally change the export extension/label from `.xml` to a clearly-named
   "source data" file; do NOT present the XML as filing-ready.
3. DEFERRED (documented, not built now): implement NSDL FVU fixed-width TXT
   format (Batch Header / Challan Detail / Deductee Detail records per the NSDL
   File Format spec) + challan/CSI capture UI, so output passes FVU. This mirrors
   Keka, which also requires manual challan entry before FVU generation.
- **Validation:** UI no longer implies Form 24Q XML is directly fileable;
  guidance points to RPU/FVU.

### Task 6 — ESI Challan & PT Return honest relabel
1. No format rebuild. Relabel display to "ESI Contribution Summary" and
   "PT Contribution Summary"; frontend `complianceStatus: 'reference_summary'`.
2. Optionally add a header note inside the generated text file clarifying it is
   a reference summary for manual portal entry, not the portal upload template.
- **Validation:** labels/badges reflect reference-only status.

### Task 7 — Bonus Form C: configurable %, annual wages, full wiring (last)
1. Change signature to accept a financial year (like `generateForm16`) instead
   of a single monthly `$run`; aggregate `PayrollItem`s across the FY range
   (reuse `getFinancialYearRange`) rather than one month's `basic`.
2. Apply Payment of Bonus Act wage ceiling rules on the annual base (do not
   treat one month's `basic` as annual).
3. Replace hardcoded `8.33` with a configurable `bonusPercent` sourced from
   Payroll Settings (org `settings['payroll']['bonus_percent']`) or passed in;
   default documented as the 8.33% statutory minimum but overridable up to 20%.
4. Write output file (PDF via `renderPdf` or keep text — either is acceptable
   since it's a reference return) with `file_path`/`original_filename`.
5. Wire up: controller method + route (`/generate/bonus-form-c`) +
   `api.ts generateBonusFormC` + a `FILING_TYPES` card
   (`complianceStatus: 'reference_summary'`, needs FY + % input).
- **Validation:** bonus computed on annual wages with configurable %, file
  written, card generates successfully.

---

## Cross-cutting validation
- `php artisan test` (or targeted feature tests) for filing generation if tests exist.
- Manual: generate each type; confirm files on disk + `file_path` set (except
  intentionally state-gated LWF); confirm badges; confirm no success toast when
  a file is missing.
- Confirm `generateAllFilings` and `autoGenerateFilings` still run end-to-end
  after LWF signature change.

## Risks
- LWF rates change frequently and vary by wage slab/periodicity; verified rows
  must cite the source Act. Leave unverified states gated rather than guessing.
- Changing LWF signature breaks two call sites — must update both.
- Dompdf on large FY aggregations (Form 16/Bonus) — reuse existing payslip
  Dompdf options; keep views lightweight.
- Form 24Q full FVU format is explicitly out of scope this pass; ensure UI
  copy does not overstate compliance.

## Deferred / follow-up (documented, not built now)
- Form 24Q NSDL FVU fixed-width TXT generation + challan/CSI capture.
- Form 16 Part A TRACES upload + merge UI (if not landed in Task 4).
- LWF: verify remaining states' rates against their Acts to move them from
  `not_configured` to `ready`.

## Non-goals
- No government portal API auto-filing.
- No change to PF ECR.
- No change to `PayrollCalculatorService` tax logic.
- No inventing LWF rates for unverified/no-Act states.
