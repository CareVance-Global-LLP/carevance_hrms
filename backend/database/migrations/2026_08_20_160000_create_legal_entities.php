<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A legal entity: the thing that actually holds a PAN, a TAN and a PF code.
 *
 * One organization meant one PAN/TAN/PF code, so a group running two to four
 * companies — which most Indian mid-market groups do — could not be represented
 * at all. It ends the conversation before a demo rather than losing marks in one.
 *
 * DELIBERATELY NOT A NEW TENANCY LEVEL. 133 tables carry organization_id;
 * re-scoping them would be a months-long migration with a real chance of
 * cross-tenant leakage, and the tenant boundary is not what is wrong here. What
 * is wrong is that statutory IDENTITY was pinned to the tenant. So the entity
 * sits UNDER the organization: the tenant boundary is untouched, and only the
 * question "whose PAN files this?" gets a new answer.
 *
 * That works because the identity is already funnelled through one resolver —
 * PayrollFilingService::orgStatutoryId, nine call sites — so the change is to
 * what that resolver reads, not to every filing generator.
 *
 * Every organization gets exactly one entity here, seeded from its existing
 * settings. A single-entity organization therefore behaves identically: same
 * PAN, same TAN, same filings. Adding a second entity is then a deliberate act,
 * not something a migration did to somebody.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('legal_entities')) {
            Schema::create('legal_entities', function (Blueprint $table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->string('name');
                $table->string('legal_name')->nullable();

                // The identifiers that decide which return a person appears on.
                $table->string('pan', 10)->nullable();
                $table->string('tan', 10)->nullable();
                $table->string('pf_establishment_code', 30)->nullable();
                $table->string('esi_code', 30)->nullable();
                $table->string('lwf_code', 30)->nullable();
                $table->string('cin', 21)->nullable();
                $table->string('gstin', 15)->nullable();

                $table->string('address_line')->nullable();
                $table->string('city')->nullable();
                // Professional tax is state-levied and several states levy none,
                // so this belongs to the entity's registration, not the group's.
                $table->string('state')->nullable();
                $table->string('pincode', 10)->nullable();

                /*
                 * Exactly one primary per organization, enforced below. It is
                 * what an employee with no explicit entity falls back to, which
                 * is every employee on the day this ships — so "no primary" would
                 * mean "nobody has a PAN".
                 */
                $table->boolean('is_primary')->default(false);
                $table->boolean('is_active')->default(true);
                $table->timestamps();

                $table->index(['organization_id', 'is_active']);
            });
        }

        if (! Schema::hasColumn('users', 'legal_entity_id')) {
            Schema::table('users', function (Blueprint $table) {
                // Nullable on purpose: null means "the organization's primary
                // entity". Backfilling every user to an explicit id would make
                // the common single-entity case maintenance it does not need,
                // and would silently strand anybody created afterwards.
                $table->foreignId('legal_entity_id')->nullable()->after('organization_id')
                    ->constrained('legal_entities')->nullOnDelete();
            });
        }

        // Filings belong to an entity — one ECR per PF code, one 24Q per TAN.
        if (Schema::hasTable('payroll_filings') && ! Schema::hasColumn('payroll_filings', 'legal_entity_id')) {
            Schema::table('payroll_filings', function (Blueprint $table) {
                $table->foreignId('legal_entity_id')->nullable()->after('organization_id')
                    ->constrained('legal_entities')->nullOnDelete();
            });
        }

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP INDEX IF EXISTS legal_entities_one_primary_per_org');
            DB::statement('CREATE UNIQUE INDEX legal_entities_one_primary_per_org ON legal_entities (organization_id) WHERE is_primary = true');
        }

        $this->seedOneEntityPerOrganization();
    }

    /**
     * Give every organization the entity it has implicitly been operating as.
     *
     * Read from the same two shapes PayrollFilingService::orgStatutoryId
     * accepts — the setup wizard writes under `settings.payroll.statutory`,
     * older installs used top-level keys — so whatever an admin actually
     * configured is carried over rather than only one of the two.
     */
    private function seedOneEntityPerOrganization(): void
    {
        foreach (DB::table('organizations')->get() as $organization) {
            $exists = DB::table('legal_entities')->where('organization_id', $organization->id)->exists();
            if ($exists) {
                continue;
            }

            $settings = json_decode((string) ($organization->settings ?? '{}'), true) ?: [];
            $statutory = data_get($settings, 'payroll.statutory', []);

            $pick = function (string $wizardKey, array $legacyKeys) use ($statutory, $settings): ?string {
                $value = data_get($statutory, $wizardKey);
                if (filled($value)) {
                    return trim((string) $value);
                }

                foreach ($legacyKeys as $key) {
                    if (filled(data_get($settings, $key))) {
                        return trim((string) data_get($settings, $key));
                    }
                }

                return null;
            };

            DB::table('legal_entities')->insert([
                'organization_id' => $organization->id,
                'name' => $organization->name,
                'legal_name' => $organization->name,
                'pan' => $pick('pan', ['pan_number', 'pan']),
                'tan' => $pick('tan', ['tan_number', 'tan']),
                'pf_establishment_code' => $pick('establishmentCode', ['pf_establishment_code', 'pf_code']),
                'esi_code' => $pick('esiCode', ['esi_code', 'esi_number']),
                'lwf_code' => $pick('lwfCode', ['lwf_code']),
                'address_line' => $organization->address_line ?? null,
                'state' => $organization->state ?? null,
                'is_primary' => true,
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP INDEX IF EXISTS legal_entities_one_primary_per_org');
        }

        if (Schema::hasTable('payroll_filings') && Schema::hasColumn('payroll_filings', 'legal_entity_id')) {
            Schema::table('payroll_filings', function (Blueprint $table) {
                $table->dropConstrainedForeignId('legal_entity_id');
            });
        }

        if (Schema::hasColumn('users', 'legal_entity_id')) {
            Schema::table('users', function (Blueprint $table) {
                $table->dropConstrainedForeignId('legal_entity_id');
            });
        }

        Schema::dropIfExists('legal_entities');
    }
};
