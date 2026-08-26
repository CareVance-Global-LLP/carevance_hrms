<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use App\Services\Lifecycle\EmployeeHistoryProbe;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * The probe must classify EVERY cascading foreign key into `users`.
 *
 * The first version listed thirteen models by hand out of the hundred-odd
 * tables that cascade, so an account whose only record was a Form 16, a
 * salary bank account, a completed performance review or a paid reimbursement
 * was deleted with a 200 and the row went with it. A hand-written list is
 * always a snapshot of the schema on the day somebody wrote it; this test is
 * what keeps it a description of the schema today.
 *
 * A new cascading FK therefore fails here until somebody decides which it is:
 * evidence to keep, or a row with no meaning once the account is gone. Both
 * answers are fine. Not answering is not.
 */
class EmployeeHistoryProbeCoversTheSchemaTest extends TestCase
{
    use RefreshDatabase;

    /** @return array<string, string> "table.column" => on_delete */
    private function cascadingUserForeignKeys(): array
    {
        $found = [];

        foreach (Schema::getTableListing() as $table) {
            $bare = (string) $table;
            if (($dot = strrpos($bare, '.')) !== false) {
                $bare = substr($bare, $dot + 1);
            }

            foreach (Schema::getForeignKeys($bare) as $key) {
                $foreignTable = (string) ($key['foreign_table'] ?? '');
                if (($dot = strrpos($foreignTable, '.')) !== false) {
                    $foreignTable = substr($foreignTable, $dot + 1);
                }

                if ($foreignTable !== 'users') {
                    continue;
                }

                if (strtolower((string) ($key['on_delete'] ?? '')) !== 'cascade') {
                    continue;
                }

                foreach ((array) ($key['columns'] ?? []) as $column) {
                    $found[$bare.'.'.$column] = 'cascade';
                }
            }
        }

        return $found;
    }

    public function test_every_cascading_foreign_key_into_users_is_classified(): void
    {
        $cascading = $this->cascadingUserForeignKeys();

        $this->assertNotEmpty(
            $cascading,
            'The schema reader found no cascading foreign keys into users, so this test proves nothing.'
        );

        $covered = [];
        foreach (EmployeeHistoryProbe::HISTORY as [$table, $column]) {
            $covered[$table.'.'.$column] = true;
        }

        $unclassified = array_values(array_filter(
            array_keys($cascading),
            fn (string $pair): bool => ! isset($covered[$pair])
                && ! array_key_exists($pair, EmployeeHistoryProbe::NOT_HISTORY)
        ));

        sort($unclassified);

        $this->assertSame(
            [],
            $unclassified,
            "These columns CASCADE off a users row and the delete guard neither checks them nor "
            ."says why it does not. Deleting an account silently destroys them. Add each to "
            .'EmployeeHistoryProbe::HISTORY, or to NOT_HISTORY with the reason: '
            .implode(', ', $unclassified)
        );
    }

    public function test_nothing_is_classified_twice_or_against_a_table_that_is_gone(): void
    {
        foreach (EmployeeHistoryProbe::NOT_HISTORY as $pair => $reason) {
            $this->assertNotSame('', trim((string) $reason), "{$pair} is excluded with no reason given.");

            foreach (EmployeeHistoryProbe::HISTORY as [$table, $column]) {
                $this->assertNotSame(
                    $pair,
                    $table.'.'.$column,
                    "{$pair} is listed as both history and not-history."
                );
            }
        }

        // A stale entry is not harmless: it makes the covered set look bigger
        // than it is, which is how the gap this test exists for reappears. The
        // check is that the COLUMN is still there, not that it still cascades
        // — `bank_transfer_batches` is a known drift between the migrations
        // and Postgres (see CLAUDE.md), and probing a column whose delete rule
        // differs between the two costs nothing and is the safe direction.
        foreach (EmployeeHistoryProbe::HISTORY as [$table, $column]) {
            $this->assertTrue(
                Schema::hasColumn($table, $column),
                "EmployeeHistoryProbe checks {$table}.{$column}, which no longer exists."
            );
        }


    }

    /**
     * The probe must not read history through an org-scoped model.
     *
     * `time_entries.organization_id` is nullable and the tracker writes rows
     * from paths where nobody is authenticated. Queried through the Eloquent
     * model, `BelongsToOrganization` adds the ACTING user's organisation to
     * the where clause, so an unstamped row was invisible and the delete
     * answered 200 with eight tracked hours going with it.
     */
    public function test_history_with_no_organization_stamp_is_still_found(): void
    {
        $org = Organization::create(['name' => 'CareVance', 'slug' => 'probe-unstamped']);

        $admin = User::create([
            'name' => 'Admin',
            'email' => 'probe-admin@carevance.test',
            'password' => bcrypt('password123'),
            'role' => 'admin',
            'organization_id' => $org->id,
        ]);

        $employee = User::create([
            'name' => 'Tracked',
            'email' => 'probe-tracked@carevance.test',
            'password' => bcrypt('password123'),
            'role' => 'employee',
            'organization_id' => $org->id,
        ]);

        DB::table('time_entries')->insert([
            'organization_id' => null,
            'user_id' => $employee->id,
            'start_time' => '2026-07-14 09:00:00',
            'end_time' => '2026-07-14 17:00:00',
            'duration' => 28800,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->assertSame('tracked time', app(EmployeeHistoryProbe::class)->firstTraceOf($employee));

        $this->withHeaders($this->apiHeadersFor($admin))
            ->deleteJson("/api/users/{$employee->id}")
            ->assertStatus(422)
            ->assertJsonPath('error_code', 'HAS_HISTORY');

        $this->assertDatabaseHas('users', ['id' => $employee->id]);
        $this->assertSame(1, DB::table('time_entries')->where('user_id', $employee->id)->count());
    }
}
