<?php

namespace Tests\Feature;

use App\Models\EmployeeBankAccount;
use App\Models\EmployeeGovernmentId;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\WithoutMiddleware;
use Tests\TestCase;

/**
 * What the "Add New Government ID" and "Add New Bank Account" forms are
 * supposed to do when they are used more than once for the same employee.
 *
 * The UI renders both as lists and labels the forms "Add New", so an employee
 * is expected to carry an Aadhaar *and* a PAN, and more than one bank account.
 * Adding a second record of the same type is the one case that should collapse
 * onto the existing row rather than pile up duplicates.
 */
class EmployeeIdentityProofTest extends TestCase
{
    use RefreshDatabase;
    use WithoutMiddleware;

    /** Valid under the Verhoeff checksum in IndianIdValidationService. */
    private const AADHAAR = '234523452343';
    private const AADHAAR_CORRECTED = '234523452358';
    private const PAN = 'ABCPE1234F';

    public function test_aadhaar_and_pan_are_kept_as_separate_records(): void
    {
        [$admin, $employee] = $this->orgWithEmployee('two-types');

        $this->actingAs($admin)
            ->postJson("/api/employees/{$employee->id}/government-ids", [
                'id_type' => 'AADHAAR',
                'id_number' => self::AADHAAR,
            ])
            ->assertCreated();

        $this->actingAs($admin)
            ->postJson("/api/employees/{$employee->id}/government-ids", [
                'id_type' => 'PAN',
                'id_number' => self::PAN,
            ])
            ->assertCreated();

        $records = EmployeeGovernmentId::query()
            ->where('user_id', $employee->id)
            ->get();

        $this->assertCount(
            2,
            $records,
            'Adding a PAN after an Aadhaar must not replace it — an employee needs both on file.'
        );
        $this->assertEqualsCanonicalizing(
            ['AADHAAR', 'PAN'],
            $records->pluck('id_type')->map(fn ($type) => strtoupper((string) $type))->all()
        );
        $this->assertEqualsCanonicalizing(
            [self::AADHAAR, self::PAN],
            $records->pluck('id_number')->all()
        );
    }

    public function test_resubmitting_the_same_id_type_updates_the_existing_record(): void
    {
        [$admin, $employee] = $this->orgWithEmployee('same-type');

        $this->actingAs($admin)
            ->postJson("/api/employees/{$employee->id}/government-ids", [
                'id_type' => 'AADHAAR',
                'id_number' => self::AADHAAR,
            ])
            ->assertCreated();

        // Same employee, same type, corrected number — a typo being fixed, not
        // a second Aadhaar. One row, holding the new value.
        $this->actingAs($admin)
            ->postJson("/api/employees/{$employee->id}/government-ids", [
                'id_type' => 'AADHAAR',
                'id_number' => self::AADHAAR_CORRECTED,
            ])
            ->assertSuccessful();

        $records = EmployeeGovernmentId::query()
            ->where('user_id', $employee->id)
            ->where('id_type', 'AADHAAR')
            ->get();

        $this->assertCount(1, $records, 'Two Aadhaar rows for one employee is never valid.');
        $this->assertSame(self::AADHAAR_CORRECTED, $records->first()->id_number);
    }

    /**
     * @dataProvider identityProofProvider
     */
    public function test_every_id_type_coexists_with_aadhaar(string $type, string $number): void
    {
        [$admin, $employee] = $this->orgWithEmployee('coexist-'.strtolower($type));

        $this->actingAs($admin)
            ->postJson("/api/employees/{$employee->id}/government-ids", [
                'id_type' => 'AADHAAR',
                'id_number' => self::AADHAAR,
            ])
            ->assertCreated();

        $this->actingAs($admin)
            ->postJson("/api/employees/{$employee->id}/government-ids", [
                'id_type' => $type,
                'id_number' => $number,
            ])
            ->assertCreated();

        $types = EmployeeGovernmentId::query()
            ->where('user_id', $employee->id)
            ->pluck('id_type')
            ->map(fn ($value) => strtoupper((string) $value))
            ->all();

        $this->assertEqualsCanonicalizing(['AADHAAR', $type], $types);
    }

    public static function identityProofProvider(): array
    {
        return [
            'PAN' => ['PAN', self::PAN],
            'Passport' => ['PASSPORT', 'A1234567'],
            'Voter ID' => ['VOTER_ID', 'ABC1234567'],
            'Driving licence' => ['DRIVING_LICENSE', 'MH1420110012345'],
        ];
    }

    public function test_a_second_bank_account_does_not_replace_the_first(): void
    {
        [$admin, $employee] = $this->orgWithEmployee('two-banks');

        $this->actingAs($admin)
            ->postJson("/api/employees/{$employee->id}/bank-accounts", [
                'bank_name' => 'State Bank of India',
                'account_number' => '30123456789',
                'ifsc_swift' => 'SBIN0001234',
                'account_type' => 'savings',
                'is_default' => true,
            ])
            ->assertSuccessful();

        $this->actingAs($admin)
            ->postJson("/api/employees/{$employee->id}/bank-accounts", [
                'bank_name' => 'HDFC Bank',
                'account_number' => '50100123456789',
                'ifsc_swift' => 'HDFC0000123',
                'account_type' => 'savings',
                'is_default' => false,
            ])
            ->assertSuccessful();

        $accounts = EmployeeBankAccount::query()->where('user_id', $employee->id)->get();

        $this->assertCount(2, $accounts, 'Adding a second payout account must not overwrite the first.');
        $this->assertEqualsCanonicalizing(
            ['30123456789', '50100123456789'],
            $accounts->pluck('account_number')->all()
        );
        $this->assertSame(
            1,
            $accounts->where('is_default', true)->count(),
            'Exactly one account should be flagged as the default payout account.'
        );
    }

    public function test_a_malformed_aadhaar_is_rejected_before_it_is_stored(): void
    {
        [$admin, $employee] = $this->orgWithEmployee('bad-aadhaar');

        $this->actingAs($admin)
            ->postJson("/api/employees/{$employee->id}/government-ids", [
                'id_type' => 'AADHAAR',
                'id_number' => '111111111111',
            ])
            ->assertStatus(422)
            ->assertJsonPath('message', 'Invalid ID format');

        $this->assertSame(0, EmployeeGovernmentId::query()->where('user_id', $employee->id)->count());
    }

    /** @return array{0: User, 1: User} */
    private function orgWithEmployee(string $slug): array
    {
        $org = Organization::query()->create([
            'name' => 'Identity Proofs '.$slug,
            'slug' => 'identity-proofs-'.$slug,
        ]);

        $admin = User::query()->create([
            'name' => 'HR Admin',
            'email' => 'admin-'.$slug.'@test.com',
            'password' => bcrypt('password123'),
            'role' => 'admin',
            'organization_id' => $org->id,
            'is_active' => true,
        ]);

        $employee = User::query()->create([
            'name' => 'New Joiner',
            'email' => 'employee-'.$slug.'@test.com',
            'password' => bcrypt('password123'),
            'role' => 'employee',
            'organization_id' => $org->id,
            'is_active' => true,
        ]);

        return [$admin, $employee];
    }
}
