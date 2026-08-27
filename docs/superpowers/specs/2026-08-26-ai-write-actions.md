# AI mode — write actions

**Date:** 2026-08-26
**Status:** contract — every component implements exactly this
**Builds on:** `2026-08-24-ai-mode-grammar-v2.md` (the read path)

AI mode answers questions. This is the half that *does* something: "change the
casual leave carry-forward to 10 days, then show me."

The read path's rule was **never invent a number**. The write path's rule is
**never act on an interpretation the person has not seen**.

---

## 1. The shape

```
question
   │
   ├─ QueryPlanner maps it to data ......... TABLE      (existing)
   ├─ ActionPlanner maps it to an action ... PREVIEW    (new)
   └─ neither ............................. PROSE      (existing)
```

A preview is **not** a side effect. Nothing is written until a human clicks
Apply, and Apply posts a separate request carrying the previewed plan.

## 2. The action plan

```jsonc
{
  "action": "leave_type.update",     // must exist in ActionCatalogue
  "target": { "name": "Casual Leave" },   // how to find the row
  "changes": { "carry_forward_cap": 10 }  // field => new value
}
```

Refusal shape is the read path's: `{"error": "<one sentence>"}`.

## 3. The catalogue is the whole authority

`ActionCatalogue` is to writes what `SemanticLayer` is to reads: a hand-written,
tested list of what may happen. The model picks a key from it and supplies
values. It cannot name an endpoint, a table, a column or a model.

```php
'leave_type.update' => [
    'label' => 'Update a leave type',
    'model' => LeaveType::class,
    'target_by' => ['name'],                    // how the model resolves a target
    'permission' => 'settings.manage',          // checked against the ACTING user
    'endpoint' => ['PUT', '/api/leave-types/{id}'],
    'fields' => [
        'carry_forward_cap' => ['label' => 'Carry-forward cap', 'type' => 'integer', 'min' => 0, 'max' => 365],
        'annual_quota'      => ['label' => 'Annual quota',      'type' => 'number',  'min' => 0, 'max' => 365],
    ],
    // Answers "and who does this land on?" — a count, never a list of names.
    'impact' => 'employees_in_organization',
],
```

**First-pass catalogue — three actions, no more.** Proving the whole path end to
end matters more than breadth, and every action costs a preview, a permission
check and its own tests.

| Key | What it changes |
|---|---|
| `leave_type.update` | carry-forward cap, annual quota |
| `organization.update` | name, timezone, working-day settings |
| `department.rename` | a group's name |

## 4. Rules that are not negotiable

**EXECUTION GOES THROUGH THE REAL ENDPOINT, NEVER ELOQUENT.** The catalogue
names an HTTP method and route, and the executor dispatches an internal request
as the acting user. That is what keeps every FormRequest rule, every
authorization check, every audit-log hook and `BelongsToOrganization`'s scope
firing. A direct `$model->update()` bypasses all of it silently, and this
codebase has **0 Laravel policies** — controllers are where authorization
actually lives, so routing around them removes it entirely.

**THE PREVIEW IS COMPUTED, NOT PROMISED.** `before` is read from the live row at
preview time. A preview that echoes the model's own idea of the current value
would show a diff that never existed.

**THE PREVIEWED PLAN IS WHAT EXECUTES.** Apply posts the plan back and it is
re-validated from scratch — the catalogue, the permission and the field bounds
are all checked again. A client that edits the payload gets the same refusal a
fresh request would.

**RE-READ BEFORE WRITING.** Between preview and Apply, somebody else may have
changed the row. If `before` no longer matches the live value, the write is
REFUSED and the preview is regenerated. Applying a diff to a value that has
moved is how one person's change silently erases another's.

**PERMISSION IS CHECKED AGAINST THE ACTING USER, TWICE.** Once when building the
preview, so an unauthorised person is told immediately rather than after
composing a change; and once at execution, because the two are separate requests
and a role can change between them.

**THE AUDIT RECORDS THAT IT WAS AI-INITIATED, AND WHO CONFIRMED.** "Who changed
this?" must stay answerable. The actor is the human who clicked Apply — never a
service account — with the original question stored alongside.

**PAYROLL IS READ, NAVIGATE AND PREPARE ONLY.** No action may lock, approve,
release or disburse a run. Those carry maker-checker precisely so one actor
cannot do them alone, and an AI shortcut through that defeats the control. Not
in the catalogue, and `ActionCatalogueTest` asserts it stays out.

**NOTHING DESTRUCTIVE.** No deletes, no money, no state transitions. The
first-pass catalogue is reversible field edits.

## 5. Response shapes

Preview, from `POST /api/search/ask`:

```jsonc
{
  "kind": "action",
  "action": {
    "key": "leave_type.update",
    "label": "Update a leave type",
    "target": { "id": 3, "label": "Casual Leave" },
    "changes": [
      { "field": "carry_forward_cap", "label": "Carry-forward cap", "from": 5, "to": 10 }
    ],
    "impact": "Affects 47 employees",
    "token": "<opaque, signed, carries the plan + the before-values>"
  }
}
```

Execution, `POST /api/search/act` with `{ "token": "..." }`:

```jsonc
{
  "applied": true,
  "message": "Casual Leave carry-forward cap changed from 5 to 10 days.",
  "route": "/settings/leave"        // where to send them to see it
}
```

**The token is signed and short-lived** (5 minutes). It carries the plan and the
before-values so the re-read check has something to compare against, and signing
it is what stops a client applying a plan the server never previewed.

## 6. Refusals

The read path's two categories, plus one:

1. **Not in the catalogue** — "I can't change that." Named, so it is
   actionable: *"There is no action for deleting an employee."*
2. **Not permitted** — the acting user lacks the permission. Says which.
3. **Stale** — the row changed since the preview. Regenerate, do not apply.

A refusal is never a fallback to prose. A person asking for a change and
receiving a paragraph would reasonably believe something happened.

## 7. What must be tested

- Every catalogue entry has a permission, an endpoint and at least one field
- No catalogue entry targets payroll state, deletion, or money
- A preview reads `before` from the live row
- A tampered token is refused
- An expired token is refused
- A stale `before` refuses rather than overwrites
- Execution goes through the HTTP route (assert the controller ran, not the model)
- An unauthorised user is refused at preview AND at execution
- The audit row names the confirming human and the original question
- Tenancy: a plan naming another organisation's row resolves to nothing
