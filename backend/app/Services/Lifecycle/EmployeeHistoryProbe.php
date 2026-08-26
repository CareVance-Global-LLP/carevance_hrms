<?php

namespace App\Services\Lifecycle;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Whether an account has anything worth keeping.
 *
 * Postgres reports 101 tables cascading off a `users` row — payslips,
 * payroll_items, form16_documents, full_and_final_settlements and
 * bank_transfer_items among them — so deleting a person destroys the
 * organisation's own evidence that it paid them, which statute requires it to
 * retain. There is no foreign-key violation to catch it: every one of those
 * FKs is ON DELETE CASCADE, so the delete succeeds and returns 200.
 *
 * Deletion therefore survives only for an account nothing ever happened to: a
 * mistyped invite nobody used. Everything else deactivates — `User` has no
 * SoftDeletes and deliberately is not gaining any, because deactivation is
 * already the archive mechanism.
 *
 * Three things about how this is written are load-bearing:
 *
 * - **It is default-DENY, and the schema is what decides.** The first version
 *   listed thirteen models and let the other ninety-five cascade away in
 *   silence: an account whose only record was a Form 16, a salary bank
 *   account, a completed performance review or a paid reimbursement deleted
 *   with a 200. Every cascading foreign key into `users` is now classified
 *   here as either history or explicitly not-history with a reason, and
 *   `EmployeeHistoryProbeCoversTheSchemaTest` reads the live schema and fails
 *   if a new one is neither. A table nobody classified must never be a table
 *   nobody checks.
 *
 * - **It queries the TABLES, never the models.** Every model carrying
 *   `BelongsToOrganization` adds a global scope resolved from the *acting*
 *   user, so a history row whose `organization_id` is null or mis-stamped was
 *   invisible to the guard and the delete went through — the exact
 *   silent-false the guard exists to eliminate, and `time_entries` is
 *   nullable there. `user_id` identifies the person on its own; the tenant
 *   check belongs on the route (`canAccessUser`) and is already there.
 *
 * - **One round trip, not one per table.** A CASE short-circuits at the first
 *   match in both Postgres and SQLite, so a person with attendance costs one
 *   query rather than ninety. Bulk delete runs this per selected person.
 */
class EmployeeHistoryProbe
{
    /**
     * Rows that mean something happened to — or was done by — this person.
     *
     * `[table, column, label]`, ordered so the commonest evidence answers
     * first and the label reads naturally in "Ada has ___ on file".
     *
     * Actor columns are here too, and not as an afterthought: `chat_groups.
     * created_by`, `bank_transfer_batches.created_by` and
     * `custom_report_definitions.created_by` all cascade, so deleting the
     * admin who made one destroys the group, the batch or the report itself
     * along with everyone else's rows hanging off it.
     */
    public const HISTORY = [
        ['attendance_records', 'user_id', 'attendance records'],
        ['time_entries', 'user_id', 'tracked time'],
        ['payslips', 'user_id', 'payslips'],
        ['leave_requests', 'user_id', 'leave requests'],
        ['employee_documents', 'user_id', 'uploaded documents'],
        ['employee_government_ids', 'user_id', 'government ID records'],
        ['resignations', 'user_id', 'a resignation'],
        ['payroll_items', 'user_id', 'payroll records'],
        ['bank_transfer_items', 'user_id', 'bank transfers'],
        // The legacy `payrolls` table is being retired but still holds real
        // rows, and they are as much a record as the new ones.
        ['payrolls', 'user_id', 'payroll records'],
        ['full_and_final_settlements', 'user_id', 'a final settlement'],
        // `leave_ledger`, singular.
        ['leave_ledger', 'user_id', 'a leave ledger'],
        ['employee_exits', 'user_id', 'an exit record'],

        // Attendance, in the shapes the older list missed. A biometric-only
        // site writes punches and never an attendance_records row until the
        // pairer runs.
        ['attendance_punches', 'user_id', 'attendance records'],
        ['attendance_selfies', 'user_id', 'attendance records'],
        ['attendance_violations', 'user_id', 'attendance records'],
        ['attendance_time_edit_requests', 'user_id', 'attendance records'],
        ['break_times', 'user_id', 'break records'],
        ['geofence_logs', 'user_id', 'location records'],

        // Tracking.
        ['activities', 'user_id', 'tracked time'],
        ['activity_sessions', 'user_id', 'tracked time'],
        ['employee_activity_logs', 'user_id', 'tracked activity'],
        ['monitoring_consents', 'user_id', 'a monitoring consent'],

        // Pay, in every table it is recorded in.
        ['payslip_ytd_history', 'employee_id', 'payslips'],
        ['pay_run_items', 'user_id', 'payroll records'],
        ['payroll_time_entries', 'user_id', 'payroll records'],
        ['payroll_adjustments', 'user_id', 'payroll records'],
        ['payroll_loan_recoveries', 'user_id', 'payroll records'],
        ['arrear_payments', 'user_id', 'arrears'],
        ['leave_encashments', 'user_id', 'a leave encashment'],
        ['employee_loans', 'user_id', 'a loan'],
        ['employee_variable_pay', 'user_id', 'variable pay records'],
        ['variable_pay_assignments', 'user_id', 'variable pay records'],
        ['perquisite_records', 'user_id', 'perquisite records'],
        ['employee_perquisites', 'user_id', 'perquisite records'],
        ['fbp_allocations', 'user_id', 'flexible benefit records'],
        ['fbp_claims', 'user_id', 'flexible benefit records'],
        ['reimbursements', 'user_id', 'reimbursements'],
        ['payment_reversals', 'user_id', 'a payment reversal'],
        ['payment_reversals', 'requested_by', 'a payment reversal they requested'],
        ['stop_payment_flags', 'user_id', 'a stop-payment flag'],
        ['stop_payment_flags', 'raised_by', 'a stop-payment flag they raised'],
        ['bank_transfer_batches', 'created_by', 'bank transfers they prepared'],

        // Statutory. `form16_documents` is the table this class's own docblock
        // named as the reason deletion is dangerous, and the first version did
        // not check it.
        ['form16_documents', 'user_id', 'a Form 16'],
        ['payroll_tax_declarations', 'user_id', 'tax declarations'],
        ['employee_tax_declarations', 'user_id', 'tax declarations'],
        ['tax_proof_submissions', 'user_id', 'tax proofs'],
        ['tax_wizard_sessions', 'user_id', 'tax declarations'],

        // Compensation as recorded over time.
        ['salary_revision_letters', 'user_id', 'salary revision letters'],
        ['salary_revision_letters', 'generated_by', 'salary revision letters they issued'],
        ['employee_salary_assignments', 'user_id', 'salary history'],
        ['payroll_structures', 'user_id', 'a salary structure'],
        ['payroll_profiles', 'user_id', 'a payroll profile'],
        ['pay_group_assignments', 'user_id', 'a pay group assignment'],
        ['employee_bank_accounts', 'user_id', 'a salary bank account'],

        // Leave and comp-off balances are ledgers in their own right.
        ['comp_off_balance', 'user_id', 'comp-off records'],
        ['comp_off_balances', 'user_id', 'comp-off records'],
        ['comp_off_transactions', 'user_id', 'comp-off records'],

        // Performance and recruitment.
        ['performance_reviews', 'employee_id', 'performance reviews'],
        ['performance_reviews', 'reviewer_id', 'performance reviews they wrote'],
        ['performance_goals', 'employee_id', 'performance goals'],
        ['performance_goals', 'manager_id', 'performance goals they set'],
        ['goal_check_ins', 'user_id', 'performance goals'],
        ['review_cycle_participants', 'employee_id', 'performance reviews'],
        ['interview_feedback', 'user_id', 'interview feedback'],
        ['interview_panellists', 'user_id', 'interview panels'],
        ['offer_approvals', 'approver_id', 'offer approvals'],

        // Rostering and the policies somebody configured for this person.
        ['roster_days', 'user_id', 'roster days'],
        ['employee_shifts', 'user_id', 'shift assignments'],
        ['employee_shift_rotations', 'user_id', 'shift assignments'],
        ['shift_swap_requests', 'requested_by', 'a shift swap'],
        ['shift_swap_requests', 'requested_with', 'a shift swap'],
        ['employee_overtime_policies', 'user_id', 'an overtime policy'],
        ['employee_penalisation_policies', 'user_id', 'a penalisation policy'],
        ['employee_shift_allowance_policies', 'user_id', 'a shift allowance policy'],
        ['employee_weekly_off_policies', 'user_id', 'a weekly off policy'],

        // Things they wrote. Chat rows carry other people's conversations with
        // them, and the group/conversation rows cascade wholesale.
        ['chat_messages', 'sender_id', 'chat messages'],
        ['chat_group_messages', 'sender_id', 'chat messages'],
        ['chat_message_reactions', 'user_id', 'chat messages'],
        ['chat_group_message_reactions', 'user_id', 'chat messages'],
        ['chat_conversations', 'participant_one_id', 'chat conversations'],
        ['chat_conversations', 'participant_two_id', 'chat conversations'],
        ['chat_groups', 'created_by', 'chat groups they created'],
        ['task_comments', 'user_id', 'task comments'],
        ['task_attachments', 'user_id', 'task attachments'],
        ['poll_votes', 'user_id', 'poll votes'],
        ['custom_report_definitions', 'created_by', 'saved reports they created'],
        ['ai_chat_logs', 'user_id', 'AI assistant history'],
        ['break_glass_sessions', 'target_user_id', 'a break-glass session'],
    ];

    /**
     * Cascading foreign keys that are deliberately NOT history, each with the
     * reason. The completeness test reads this, so an entry here is a stated
     * decision rather than an omission.
     */
    public const NOT_HISTORY = [
        // `POST /users` writes all four within milliseconds of the account, so
        // probing any one would make every user undeletable from birth and
        // break the Add User wizard's own rollback.
        'employee_profiles.user_id' => 'created with the account',
        'employee_work_infos.user_id' => 'created with the account',
        'employee_payroll_templates.user_id' => 'created with the account',
        'onboarding_journeys.user_id' => 'created with the account',

        // Membership and assignment. Removing somebody from a department, a
        // project or a task list records nothing about them.
        'group_user.user_id' => 'department membership, not a record',
        'department_team_members.user_id' => 'team membership, not a record',
        'department_team_managers.user_id' => 'team membership, not a record',
        'project_user.user_id' => 'project membership, not a record',
        'task_user.user_id' => 'task assignment, not a record',
        'task_watchers.user_id' => 'task subscription, not a record',
        'chat_group_members.user_id' => 'chat group membership, not a record',

        // An unreturned laptop is a custody problem for someone to chase, not
        // a record the organisation is obliged to keep.
        'asset_assignments.user_id' => 'custody, chased separately',

        // Ephemeral or re-derivable.
        'chat_typing_statuses.user_id' => 'ephemeral presence',
        'chat_group_typing_statuses.user_id' => 'ephemeral presence',
        'app_notifications.user_id' => 'delivery, not a record',
        'device_tokens.user_id' => 'push registration',
        'upload_sessions.user_id' => 'swept hourly by schedule:uploads-purge',

        // Credentials. These exist to protect the account and have no meaning
        // once it is gone.
        'user_mfa_secrets.user_id' => 'credential',
        'user_recovery_codes.user_id' => 'credential',
    ];

    /**
     * A human label for the first record found, or null when there is none.
     */
    public function firstTraceOf(User $user): ?string
    {
        $checks = $this->applicableChecks();

        if ($checks === []) {
            return null;
        }

        $cases = [];
        $bindings = [];

        foreach ($checks as [$table, $column, $label]) {
            $cases[] = "WHEN EXISTS (SELECT 1 FROM \"{$table}\" WHERE \"{$column}\" = ?) THEN ?";
            $bindings[] = $user->id;
            $bindings[] = $label;
        }

        $row = DB::selectOne(
            'SELECT CASE '.implode(' ', $cases).' ELSE NULL END AS trace',
            $bindings
        );

        $trace = $row->trace ?? null;

        return $trace === null ? null : (string) $trace;
    }

    public function hasHistory(User $user): bool
    {
        return $this->firstTraceOf($user) !== null;
    }

    /**
     * The checks whose table is actually present.
     *
     * A table listed here but absent from the database would otherwise turn
     * every delete into a 500. Resolved once per request from a single
     * catalogue read.
     *
     * @return array<int, array{0: string, 1: string, 2: string}>
     */
    private function applicableChecks(): array
    {
        static $cache = null;

        if ($cache !== null) {
            return $cache;
        }

        $present = [];
        foreach (Schema::getTableListing() as $name) {
            // Postgres can hand back `public.users`; SQLite hands back `users`.
            $bare = (string) $name;
            if (($dot = strrpos($bare, '.')) !== false) {
                $bare = substr($bare, $dot + 1);
            }
            $present[$bare] = true;
        }

        return $cache = array_values(array_filter(
            self::HISTORY,
            fn (array $check): bool => isset($present[$check[0]])
        ));
    }
}
