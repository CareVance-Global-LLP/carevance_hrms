<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Requisitions are archived, not erased.
 *
 * Two reasons, and the second is the one that bites.
 *
 * A closed requisition is a record: it had candidates, approvals and an agreed
 * headcount, and hard-deleting it takes their history with it.
 *
 * And the reference must never be reused. `REQ-2` gets quoted in approval
 * emails and offer letters; if deleting it frees the number for the next
 * opening, that email now points at a different role. The generator reads the
 * highest number INCLUDING archived rows, which only works if the row survives.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('job_openings', function (Blueprint $table) {
            $table->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::table('job_openings', function (Blueprint $table) {
            $table->dropSoftDeletes();
        });
    }
};
