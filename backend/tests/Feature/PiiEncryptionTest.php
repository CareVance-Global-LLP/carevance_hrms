<?php

namespace Tests\Feature;

use App\Models\EmployeeBankAccount;
use App\Models\EmployeeGovernmentId;
use App\Models\EmployeeProfile;
use App\Models\Organization;
use App\Models\User;
use App\Support\BlindIndex;
use App\Traits\EncryptsPii;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Employee PII at rest.
 *
 * Account numbers, UPI IDs, PAN, Aadhaar and other government identifiers were
 * stored as ordinary columns, so a database dump — a backup file, a mis-scoped
 * replica, a compromised ops account — carried the complete financial identity
 * of every employee in every tenant.
 */
class PiiEncryptionTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $employee;

    /**
     * model class => columns that must be encrypted.
     *
     * Extend this when a new column holds statutory identity or bank details.
     * The coverage test below then requires both halves — the cast and the
     * trait — because either alone is worse than neither.
     *
     * @return array<class-string, array<int, string>>
     */
    public static function encryptedColumns(): array
    {
        return [
            EmployeeProfile::class => ['pan_number', 'uan_number', 'esi_ip_number'],
            EmployeeBankAccount::class => ['account_number', 'upi_id'],
            EmployeeGovernmentId::class => ['id_number'],
        ];
    }

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();
        $this->employee = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);
    }

    // -------------------------------------------------------------- coverage

    public function test_every_declared_pii_column_has_both_a_cast_and_an_index(): void
    {
        $missing = [];

        foreach (self::encryptedColumns() as $class => $columns) {
            $model = new $class();

            if (! in_array(EncryptsPii::class, class_uses_recursive($class), true)) {
                $missing[] = "{$class} does not use EncryptsPii, so its blind index is never maintained.";

                continue;
            }

            $casts = $model->getCasts();
            $declared = $model->piiColumns();

            foreach ($columns as $column) {
                if (($casts[$column] ?? null) !== 'encrypted') {
                    $missing[] = "{$class}::{$column} is not cast as encrypted.";
                }

                if (! in_array($column, $declared, true)) {
                    $missing[] = "{$class}::{$column} is missing from piiColumns(), so no index is written.";
                }
            }
        }

        $this->assertSame([], $missing, implode("\n  ", $missing));
    }

    public function test_the_backing_columns_exist(): void
    {
        foreach ([
            'employee_profiles' => ['pan_number', 'uan_number', 'esi_ip_number'],
            'employee_bank_accounts' => ['account_number', 'upi_id'],
            'employee_government_ids' => ['id_number'],
        ] as $table => $columns) {
            foreach ($columns as $column) {
                $this->assertTrue(
                    \Illuminate\Support\Facades\Schema::hasColumn($table, $column.'_bidx'),
                    "{$table}.{$column}_bidx is missing — lookups would silently match nothing."
                );
            }
        }
    }

    // ------------------------------------------------------------ at rest

    public function test_a_bank_account_number_is_not_readable_in_the_database(): void
    {
        $account = EmployeeBankAccount::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'account_holder_name' => 'Test Employee',
            'account_number' => '50100123456789',
            'ifsc_swift' => 'HDFC0001234',
            'bank_name' => 'HDFC',
        ]);

        $raw = DB::table('employee_bank_accounts')->where('id', $account->id)->first();

        $this->assertNotSame('50100123456789', $raw->account_number);
        $this->assertStringNotContainsString('50100123456789', (string) $raw->account_number);

        // ...and still reads back correctly through the model.
        $this->assertSame('50100123456789', $account->fresh()->account_number);
    }

    public function test_a_government_id_number_is_not_readable_in_the_database(): void
    {
        $id = EmployeeGovernmentId::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'id_type' => 'aadhaar',
            'id_number' => '123456789012',
        ]);

        $raw = DB::table('employee_government_ids')->where('id', $id->id)->first();

        $this->assertStringNotContainsString('123456789012', (string) $raw->id_number);
        $this->assertSame('123456789012', $id->fresh()->id_number);
    }

    public function test_the_ifsc_is_deliberately_left_readable(): void
    {
        $account = EmployeeBankAccount::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'account_holder_name' => 'Test Employee',
            'account_number' => '50100123456789',
            'ifsc_swift' => 'HDFC0001234',
            'bank_name' => 'HDFC',
        ]);

        $raw = DB::table('employee_bank_accounts')->where('id', $account->id)->first();

        // An IFSC identifies a bank branch and is published by the RBI.
        // Encrypting it protects nothing and breaks the whereNotNull checks
        // that decide who can be paid.
        $this->assertSame('HDFC0001234', $raw->ifsc_swift);
    }

    // ------------------------------------------------------------- lookups

    public function test_the_index_is_written_and_lets_a_lookup_find_the_row(): void
    {
        EmployeeGovernmentId::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'id_type' => 'pan',
            'id_number' => 'ABCDE1234F',
        ]);

        $found = EmployeeGovernmentId::query()->wherePii('id_number', 'ABCDE1234F')->first();

        $this->assertNotNull($found, 'A blind-index lookup must find the row.');
        $this->assertSame('ABCDE1234F', $found->id_number);
    }

    public function test_the_lookup_normalises_case_and_whitespace_exactly_as_the_old_sql_did(): void
    {
        EmployeeGovernmentId::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'id_type' => 'pan',
            'id_number' => '  abcde1234f ',
        ]);

        // The queries this replaced were UPPER(TRIM(id_number)) = ?
        $this->assertNotNull(
            EmployeeGovernmentId::query()->wherePii('id_number', 'ABCDE1234F')->first()
        );
    }

    public function test_a_direct_equality_match_on_the_encrypted_column_finds_nothing(): void
    {
        EmployeeGovernmentId::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'id_type' => 'pan',
            'id_number' => 'ABCDE1234F',
        ]);

        // Pinned deliberately. This is the failure mode the blind index exists
        // to prevent, and it is silent: no error, just nothing found. Anyone
        // reintroducing where('id_number', $x) needs this to be unmistakable.
        $this->assertNull(
            EmployeeGovernmentId::query()->where('id_number', 'ABCDE1234F')->first(),
            'Encryption is randomised, so equality on the ciphertext can never match.'
        );
    }

    public function test_changing_a_value_moves_the_index_with_it(): void
    {
        $id = EmployeeGovernmentId::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'id_type' => 'pan',
            'id_number' => 'ABCDE1234F',
        ]);

        $id->update(['id_number' => 'ZZZZZ9999Z']);

        $this->assertNull(EmployeeGovernmentId::query()->wherePii('id_number', 'ABCDE1234F')->first());
        $this->assertNotNull(EmployeeGovernmentId::query()->wherePii('id_number', 'ZZZZZ9999Z')->first());
    }

    public function test_looking_up_nothing_returns_nothing_rather_than_everything(): void
    {
        EmployeeGovernmentId::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'id_type' => 'pan',
            'id_number' => 'ABCDE1234F',
        ]);

        // A null index would otherwise match every row that simply has no
        // value — quietly returning strangers' records for an empty search box.
        $this->assertSame(0, EmployeeGovernmentId::query()->wherePii('id_number', null)->count());
        $this->assertSame(0, EmployeeGovernmentId::query()->wherePii('id_number', '   ')->count());
    }

    // --------------------------------------------------------------- keying

    public function test_the_index_is_keyed_and_not_a_plain_hash_of_the_value(): void
    {
        $pan = 'ABCDE1234F';

        // There are few enough plausible PANs that an unkeyed SHA-256 column
        // is a rainbow table somebody has already computed.
        $this->assertNotSame(hash('sha256', $pan), BlindIndex::of($pan));
        $this->assertNotSame(hash('sha256', strtoupper($pan)), BlindIndex::of($pan));
    }

    public function test_the_same_value_indexes_identically_so_duplicates_remain_findable(): void
    {
        // Duplicate detection is the one place equal-values-index-equally is
        // wanted, and duplicate PANs are a real problem on this data.
        $this->assertSame(BlindIndex::of('ABCDE1234F'), BlindIndex::of('abcde1234f '));
        $this->assertNotSame(BlindIndex::of('ABCDE1234F'), BlindIndex::of('ZZZZZ9999Z'));
    }

    // ----------------------------------------------------- duplicate check

    /**
     * The duplicate-PAN check is the most dangerous thing to break with
     * encryption: it does not error, it just stops finding duplicates, and
     * "no duplicates" is indistinguishable from a working check.
     */
    public function test_duplicate_pan_detection_still_fires_after_encryption(): void
    {
        $other = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);

        foreach ([$this->employee, $other] as $user) {
            EmployeeGovernmentId::create([
                'organization_id' => $this->organization->id,
                'user_id' => $user->id,
                'id_type' => 'pan',
                'id_number' => 'ABCDE1234F',
            ]);
        }

        $duplicate = User::query()
            ->where('id', '!=', $this->employee->id)
            ->where('organization_id', $this->organization->id)
            ->whereHas('employeeGovernmentIds', fn ($q) => $q
                ->whereRaw('LOWER(id_type) LIKE ?', ['%pan%'])
                ->wherePii('id_number', 'ABCDE1234F'))
            ->exists();

        $this->assertTrue($duplicate, 'Two employees share a PAN and the check must see it.');
    }
}
