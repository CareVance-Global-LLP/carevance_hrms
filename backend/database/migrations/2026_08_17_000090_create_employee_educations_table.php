<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Education as records, not as a filing cabinet.
 *
 * An education certificate could already be uploaded — as an EmployeeDocument
 * with category 'education' and a free-text title. That stores the scan and
 * loses the facts: nothing recorded the qualification, the institution or the
 * year, so "who holds a B.Tech" was unanswerable without opening every PDF, and
 * a background-verification request meant reading files one at a time.
 *
 * A row per qualification, because people have several. 10th, 12th, graduation
 * and a post-graduation is the ordinary case in this market, and a single
 * "highest qualification" field cannot hold the certificate for each one.
 *
 * The certificate itself stays an EmployeeDocument, linked rather than
 * duplicated. That is the same shape employee_government_ids and
 * employee_bank_accounts already use for their proof files, and it means the
 * scan lands on the private employee_documents disk and is served through the
 * one authenticated, org-scoped download route rather than a public URL.
 *
 * Guarded — the schema has drifted from these migrations before.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('employee_educations')) {
            return;
        }

        Schema::create('employee_educations', function (Blueprint $table) {
            $table->id();

            $table->unsignedBigInteger('organization_id');
            $table->unsignedBigInteger('user_id');

            // The only required fact. Everything else about a qualification can
            // legitimately be unknown for an older joiner, but a row that does
            // not say what the qualification IS records nothing at all.
            $table->string('qualification', 120);
            $table->string('institution', 255)->nullable();
            $table->string('specialisation', 255)->nullable();
            // smallint, not a date: certificates state a year, not a day, and a
            // date column would invite inventing 1st January.
            $table->smallInteger('year_of_passing')->nullable();
            // String, because this is a percentage on one certificate, a CGPA on
            // the next and a division on a third. Normalising them would mean
            // converting between scales that do not convert.
            $table->string('grade', 40)->nullable();

            // The scan, held once in employee_documents and referenced here.
            $table->unsignedBigInteger('employee_document_id')->nullable();
            $table->text('notes')->nullable();

            $table->timestamps();

            $table->index(['organization_id', 'user_id'], 'employee_educations_lookup');

            $table->foreign('employee_document_id')
                ->references('id')
                ->on('employee_documents')
                // The certificate can be deleted without deleting the fact that
                // the qualification exists.
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('employee_educations');
    }
};
