<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Which statute an establishment works under.
 *
 * Working-hour and overtime limits are not properties of a policy somebody
 * configured — they are properties of the PREMISES and what it is registered
 * as. A factory runs under the Factories Act 1948; a back office in the same
 * group runs under that state's Shops and Establishments Act, with different
 * numbers; and a fully exempt establishment has none. The legal entity is
 * already where registration lives (PAN, TAN, PF and ESI codes, and a state),
 * so it is where this belongs too.
 *
 * Everything here defaults to the SAFE, non-enforcing setting. Turning on a
 * statutory floor changes what overtime is worth, and doing that to a live
 * payroll because somebody upgraded is not a decision this migration is
 * entitled to make on a customer's behalf.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('legal_entities', function (Blueprint $table) {
            /*
             * factory | shops_establishment | unregulated.
             *
             * Defaults to `unregulated`, meaning "nobody has told us", which is
             * honest: guessing `factory` would invent limits and breach reports
             * for a software company, and guessing `shops_establishment` would
             * quietly under-state a real factory's obligations.
             */
            $table->string('establishment_type', 32)->default('unregulated')->after('state');

            /*
             * Whether the statutory overtime multiplier is APPLIED or merely
             * reported.
             *
             * Off by default and deliberately a second act. With it off, a
             * configured rate below the statutory floor is computed, flagged
             * and reported — nothing is silently paid differently. With it on,
             * the floor is what gets paid.
             */
            $table->boolean('enforce_overtime_floor')->default(false)->after('establishment_type');

            /*
             * Section 55 lets the Chief Inspector exempt a factory, in writing,
             * so that a worker may work up to six hours before a rest interval
             * instead of five. Null means no exemption, which is the default
             * for everybody — an exemption is a document somebody holds, not a
             * state you can infer from an address.
             */
            $table->unsignedSmallInteger('rest_interval_exemption_minutes')->nullable()->after('enforce_overtime_floor');

            /*
             * Section 64(4) caps overtime at fifty hours a quarter. Section
             * 65(3) and various state amendments raise it — to 75, 115, 125 or
             * 144 hours — under an exemption. Null means the statutory default
             * for the establishment type applies.
             */
            $table->unsignedSmallInteger('quarterly_overtime_cap_hours')->nullable()->after('rest_interval_exemption_minutes');

            /*
             * The order that granted the exemption. Free text on purpose:
             * formats differ by state, and an exemption nobody can produce a
             * reference for is one an inspector will treat as absent.
             */
            $table->string('exemption_reference')->nullable()->after('quarterly_overtime_cap_hours');
        });

        /*
         * A check rather than an enum: adding a value to a Postgres enum type
         * is a migration that cannot run inside a transaction, which is a
         * needless trap for whoever adds the next establishment type.
         */
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE legal_entities DROP CONSTRAINT IF EXISTS legal_entities_establishment_check');
            DB::statement(
                "ALTER TABLE legal_entities ADD CONSTRAINT legal_entities_establishment_check "
                ."CHECK (establishment_type IN ('factory', 'shops_establishment', 'unregulated'))"
            );
        }
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE legal_entities DROP CONSTRAINT IF EXISTS legal_entities_establishment_check');
        }

        Schema::table('legal_entities', function (Blueprint $table) {
            $table->dropColumn([
                'establishment_type',
                'enforce_overtime_floor',
                'rest_interval_exemption_minutes',
                'quarterly_overtime_cap_hours',
                'exemption_reference',
            ]);
        });
    }
};
