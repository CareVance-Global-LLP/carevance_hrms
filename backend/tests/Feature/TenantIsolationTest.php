<?php

namespace Tests\Feature;

use App\Models\EmployeeBankAccount;
use App\Models\Organization;
use App\Models\User;
use App\Traits\BelongsToOrganization;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Multi-tenant isolation is a property of the models, not of the controllers.
 *
 * Every query in the application used to re-implement its own
 * `where('organization_id', ...)`, and two real leaks in this codebase came
 * from exactly one of those being forgotten. These tests assert the structural
 * guarantee instead: that tenant-owned models carry the global scope, and that
 * the scope genuinely stops a read.
 */
class TenantIsolationTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Models the trait deliberately does not cover, with the reason.
     *
     * Anything added here is a decision, not an oversight — which is the point
     * of listing them rather than silently skipping.
     */
    private const INTENTIONALLY_UNSCOPED = [
        // The scope resolves the acting user through Auth, so scoping User
        // itself needs separate handling.
        'User',
        // Cross-tenant by nature.
        'Organization',
        'OrganizationStats',
        // Written before a user exists (signup, invitation acceptance).
        'Invitation',
    ];

    public function test_the_global_scope_hides_another_tenants_rows(): void
    {
        [$mine, $theirs] = $this->twoOrganizations();

        $myAdmin = User::factory()->create([
            'organization_id' => $mine->id,
            'role' => 'admin',
        ]);
        $theirEmployee = User::factory()->create([
            'organization_id' => $theirs->id,
            'role' => 'employee',
        ]);

        // Planted directly, bypassing the scope, as a seeder or another tenant
        // would have written it.
        $foreign = EmployeeBankAccount::withoutOrganizationScope()->create([
            'organization_id' => $theirs->id,
            'user_id' => $theirEmployee->id,
            'account_holder_name' => 'Other Tenant',
            'bank_name' => 'Other Bank',
            'account_number' => '999999999999',
            'ifsc_swift' => 'OTHR0001',
        ]);

        $this->actingAs($myAdmin);

        $this->assertNull(
            EmployeeBankAccount::find($foreign->id),
            'A bank account belonging to another organization was readable.'
        );
        $this->assertSame(
            0,
            EmployeeBankAccount::where('organization_id', $theirs->id)->count(),
            'The tenant scope did not constrain an explicit cross-tenant query.'
        );

        // The escape hatch still works, so legitimate cross-tenant code paths
        // are not blocked — only silent ones.
        $this->assertNotNull(
            EmployeeBankAccount::withoutOrganizationScope()->find($foreign->id),
            'withoutOrganizationScope() should still reach other tenants.'
        );
    }

    public function test_creating_a_row_stamps_the_acting_organization(): void
    {
        [$mine] = $this->twoOrganizations();

        $admin = User::factory()->create([
            'organization_id' => $mine->id,
            'role' => 'admin',
        ]);

        $this->actingAs($admin);

        // organization_id deliberately omitted.
        $account = EmployeeBankAccount::create([
            'user_id' => $admin->id,
            'account_holder_name' => 'Stamp Test',
            'bank_name' => 'Test Bank',
            'account_number' => '123456789012',
            'ifsc_swift' => 'TEST0001',
        ]);

        $this->assertSame(
            $mine->id,
            $account->organization_id,
            'organization_id was not stamped on create.'
        );
    }

    /**
     * The guard that stops this regressing.
     *
     * A new model added against a tenant-owned table without the trait is a
     * future leak, and nothing else in the suite would notice.
     */
    public function test_every_tenant_owned_model_carries_the_trait(): void
    {
        // Schema::hasColumn rather than information_schema: the suite runs on
        // SQLite while the application runs on PostgreSQL, and this check has
        // to hold on both.
        $missing = [];

        foreach (glob(app_path('Models/*.php')) as $file) {
            $name = basename($file, '.php');

            if (in_array($name, self::INTENTIONALLY_UNSCOPED, true)) {
                continue;
            }

            $class = 'App\\Models\\'.$name;

            if (! class_exists($class)) {
                continue;
            }

            try {
                $model = new $class;
            } catch (\Throwable $e) {
                continue;
            }

            $table = $model->getTable();

            if (! Schema::hasTable($table) || ! Schema::hasColumn($table, 'organization_id')) {
                continue;
            }

            if (! in_array(BelongsToOrganization::class, class_uses_recursive($class), true)) {
                $missing[] = $name;
            }
        }

        $this->assertSame(
            [],
            $missing,
            "These models own tenant data but have no organization scope:\n  ".
            implode("\n  ", $missing).
            "\n\nAdd `use BelongsToOrganization;` to each, or list it in ".
            'TenantIsolationTest::INTENTIONALLY_UNSCOPED with a reason.'
        );
    }

    /** @return array{0: Organization, 1: Organization} */
    private function twoOrganizations(): array
    {
        return [
            Organization::factory()->create(['name' => 'Mine']),
            Organization::factory()->create(['name' => 'Theirs']),
        ];
    }
}
