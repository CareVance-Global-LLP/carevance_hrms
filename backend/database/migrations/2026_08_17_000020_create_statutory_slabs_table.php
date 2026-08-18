<?php

use App\Services\PayrollFilingService;
use App\Services\PTStateService;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Statutory slabs, effective-dated and vendor-owned.
 *
 * 36 professional-tax jurisdictions and 15 labour-welfare-fund states lived as
 * PHP constants with no date dimension. Two consequences, both live:
 *
 *  - Recomputing March used today's slab. When a rate changes mid-year, a
 *    corrected month silently acquires a rate it never paid, and no report can
 *    say which rate was actually used.
 *  - Correcting a slab meant a deploy. That is how eight jurisdictions came to
 *    levy a tax that does not exist and went uncorrected: the fix was never
 *    small enough to be routine.
 *
 * The schema is greytHR's — a real slab grid with a date range — and the
 * permission model is Keka's: shipped as migrations, READ-ONLY to tenants. A
 * tenant picks a jurisdiction; the vendor owns the rates. Keka's UI gives this
 * away in a verb, offering a "View Slab" button and never an edit, with new
 * statutory variants arriving as product releases.
 *
 * `jurisdiction_code` sits below `state_code` from the start because Tamil Nadu
 * already needs it: PT there is set by Corporation or Panchayat, nine distinct
 * local bodies with different slabs. A column now is free; a migration later is
 * not.
 *
 * Seeded from the existing constants so nothing changes behaviour on the way
 * in — this migration moves the data, it does not restate it. PTStateService
 * remains the compiled bootstrap and is deliberately left DB-free: its unit
 * tests run without a database, and a statutory calculator that cannot be
 * exercised without one is a calculator nobody will test.
 */
return new class extends Migration
{
    /** Every existing month must resolve, so the seeded rows open well before any run. */
    private const SEED_EFFECTIVE_FROM = '2020-04-01';

    public function up(): void
    {
        if (! Schema::hasTable('statutory_slabs')) {
            Schema::create('statutory_slabs', function (Blueprint $table) {
                $table->id();

                // 'pt' | 'lwf'. Income tax stays in TAX_SLABS_BY_FY: it is
                // keyed by financial year rather than by a date range, and
                // forcing it into this shape would lose that.
                $table->string('kind', 16);

                $table->string('state_code', 64);
                // Below state_code: Tamil Nadu's Corporation/Panchayat bodies.
                $table->string('jurisdiction_code', 64)->nullable();
                // Some states levy different LWF amounts by gender.
                $table->string('gender', 16)->nullable();

                $table->date('effective_from');
                // Null means "still in force". Resolution is by the period
                // being computed, never by today.
                $table->date('effective_to')->nullable();

                // 'monthly' | 'half_yearly' | 'annual'
                $table->string('frequency', 16)->default('monthly');
                // Which months the deduction is actually taken in — LWF is
                // commonly June and December only.
                $table->json('deduction_months')->nullable();

                // [{min, max, amount}, ...] plus any special-month instalment.
                $table->json('slabs');

                $table->decimal('employer_amount', 12, 2)->nullable();
                // Article 276(2) caps PT at 2,500 a year for every state and UT.
                $table->decimal('annual_cap', 12, 2)->nullable();
                // Why this row says what it says. A statutory rate with no
                // citation is how an invented slab survives review.
                $table->text('source_note')->nullable();

                $table->timestamps();

                $table->index(['kind', 'state_code', 'effective_from'], 'statutory_slabs_lookup');
            });
        }

        // Idempotent: re-running must not double the rows.
        if (DB::table('statutory_slabs')->exists()) {
            return;
        }

        $now = now();
        $rows = [];

        foreach (PTStateService::getStates() as $state) {
            $config = PTStateService::getConfiguration($state['code']);

            if (! $config) {
                continue;
            }

            $rows[] = [
                'kind' => 'pt',
                'state_code' => $state['code'],
                'jurisdiction_code' => null,
                'gender' => null,
                'effective_from' => self::SEED_EFFECTIVE_FROM,
                'effective_to' => null,
                'frequency' => 'monthly',
                'deduction_months' => null,
                'slabs' => json_encode([
                    'monthly' => $config['monthly'] ?? [],
                    // Maharashtra's higher February instalment.
                    'special' => $config['special'] ?? null,
                ]),
                'employer_amount' => null,
                'annual_cap' => 2500,
                'source_note' => 'Seeded from PTStateService::STATE_CONFIGS. '
                    .'Article 276(2) caps professional tax at 2,500 per year.',
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }

        foreach (PayrollFilingService::LWF_STATE_CONFIG as $stateCode => $config) {
            $rows[] = [
                'kind' => 'lwf',
                'state_code' => $stateCode,
                'jurisdiction_code' => null,
                'gender' => null,
                'effective_from' => self::SEED_EFFECTIVE_FROM,
                'effective_to' => null,
                'frequency' => $config['frequency'] ?? 'monthly',
                'deduction_months' => isset($config['months']) ? json_encode($config['months']) : null,
                'slabs' => json_encode($config),
                'employer_amount' => $config['employer'] ?? null,
                'annual_cap' => null,
                'source_note' => 'Seeded from PayrollFilingService::LWF_STATE_CONFIG. '
                    .'Amounts must be re-verified against each state\'s LWF Rules.',
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }

        foreach (array_chunk($rows, 50) as $chunk) {
            DB::table('statutory_slabs')->insert($chunk);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('statutory_slabs');
    }
};
