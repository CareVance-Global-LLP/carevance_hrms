<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Backfill: proofs attached to a person's own government ID or bank account are
 * theirs to see.
 *
 * `visible_to_employee` was added defaulting to false, which is right for a
 * record that can hold a warning letter as easily as an offer letter. But the
 * two PROOF categories are not like that: a scan of your own PAN card or your
 * own cancelled cheque is evidence of a fact you supplied, not something HR
 * wrote about you. The controllers now share them on upload; this brings rows
 * written before that change into line.
 *
 * Without it the employee panel shows eye and download buttons on their own
 * government ID row — the row carries its proof either way — and the API then
 * refuses the file. That is the bug this pairs with.
 *
 * Deliberately narrow. It touches ONLY government_id_proof and bank_proof.
 * Every other category — offer letters, resumes, experience letters, education
 * certificates, id_proof, address_proof — is left alone, because deciding those
 * is HR's call to make per document rather than a migration's to make in bulk.
 */
return new class extends Migration
{
    private const OWN_RECORD_PROOFS = ['government_id_proof', 'bank_proof'];

    public function up(): void
    {
        if (! Schema::hasColumn('employee_documents', 'visible_to_employee')) {
            return;
        }

        DB::table('employee_documents')
            ->whereIn('category', self::OWN_RECORD_PROOFS)
            ->update(['visible_to_employee' => true]);
    }

    /**
     * Deliberately empty.
     *
     * Reversing would hide proofs that the current code shares on upload, so a
     * rollback would recreate the broken state for rows written since. There is
     * nothing to restore either: the column held the default, not a decision
     * somebody made.
     */
    public function down(): void
    {
    }
};
