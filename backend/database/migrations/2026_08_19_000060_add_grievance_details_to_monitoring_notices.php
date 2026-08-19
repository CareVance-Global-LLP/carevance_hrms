<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Grievance redressal on the monitoring notice.
 *
 * The DPDP Rules require that a request for consent is accompanied by a notice
 * telling the person not only what is collected and why, but how to complain:
 * the contact for grievance redressal, and the fact that they may take a
 * complaint to the Data Protection Board of India.
 *
 * A notice that lists purposes but gives nobody to object to is a disclosure,
 * not a consent notice — and the obligation falls on the employer running this
 * software, which makes it the product's job to make it possible.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('monitoring_notices', function (Blueprint $table) {
            // Who inside the customer's organisation handles a complaint.
            $table->string('grievance_contact_name')->nullable()->after('retention_days');
            $table->string('grievance_contact_email')->nullable()->after('grievance_contact_name');
        });
    }

    public function down(): void
    {
        Schema::table('monitoring_notices', function (Blueprint $table) {
            $table->dropColumn(['grievance_contact_name', 'grievance_contact_email']);
        });
    }
};
