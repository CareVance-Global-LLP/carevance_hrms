<?php

namespace Database\Seeders;

use App\Models\Organization;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Generates production-like data volume to benchmark report endpoints.
 *
 * The default dev database only has ~16 users, which is not enough to
 * surface N+1 / unbounded-list regressions. This seeder creates a dedicated
 * benchmark organization with a configurable number of employees and several
 * months of time entries.
 *
 *   php artisan db:seed --class=PerformanceBenchmarkSeeder
 *   BENCHMARK_USERS=200 BENCHMARK_DAYS=120 php artisan db:seed --class=PerformanceBenchmarkSeeder
 *
 * Idempotent: it refuses to run if the benchmark organization already exists
 * (delete it first, or set BENCHMARK_FORCE=1 to append another batch).
 */
class PerformanceBenchmarkSeeder extends Seeder
{
    use WithoutModelEvents;

    public function run(): void
    {
        $userCount = (int) (env('BENCHMARK_USERS') ?: 100);
        $days = (int) (env('BENCHMARK_DAYS') ?: 90);
        $force = (bool) (env('BENCHMARK_FORCE') ?: false);

        $slug = 'benchmark-org';

        $organization = Organization::where('slug', $slug)->first();
        if ($organization && ! $force) {
            $this->command?->warn(
                "Benchmark organization '{$slug}' already exists; skipping. "
                .'Delete it first or run with --force to append another batch.'
            );

            return;
        }

        if (! $organization) {
            $organization = Organization::create([
                'name' => 'Benchmark Org',
                'slug' => $slug,
                'plan_code' => 'business',
                'billing_cycle' => 'monthly',
                'subscription_status' => 'active',
                'max_seats' => $userCount + 5,
            ]);
        }

        $this->command?->info("Creating {$userCount} users across {$days} days...");

        $admin = User::create([
            'name' => 'Benchmark Admin',
            'email' => 'benchmark-admin@example.com',
            'password' => Hash::make('12345678'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        $userIds = [];
        $now = now();
        for ($i = 0; $i < $userCount; $i++) {
            $user = User::create([
                'name' => 'Benchmark User '.$i,
                'email' => 'benchmark'.$i.'@example.com',
                'password' => Hash::make('12345678'),
                'role' => 'employee',
                'organization_id' => $organization->id,
            ]);
            $userIds[] = $user->id;
        }

        $start = $now->copy()->subDays($days - 1)->startOfDay();
        $rows = [];
        $chunkSize = 500;
        $created = 0;

        foreach ($userIds as $userId) {
            // 1-3 entries per user per day, random working hours.
            for ($day = 0; $day < $days; $day++) {
                $date = $start->copy()->addDays($day);
                $entriesToday = rand(1, 3);

                for ($e = 0; $e < $entriesToday; $e++) {
                    $startHour = rand(8, 16);
                    $startMin = [0, 15, 30, 45][rand(0, 3)];
                    $entryStart = $date->copy()->setTime($startHour, $startMin, 0);
                    $minutes = rand(30, 180);
                    $entryEnd = $entryStart->copy()->addMinutes($minutes);

                    $rows[] = [
                        'user_id' => $userId,
                        'task_id' => null,
                        'project_id' => null,
                        'start_time' => $entryStart->toDateTimeString(),
                        'end_time' => $entryEnd->toDateTimeString(),
                        'duration' => $minutes * 60,
                        'description' => 'Benchmark entry',
                        'billable' => true,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ];

                    $created++;

                    if (count($rows) >= $chunkSize) {
                        DB::table('time_entries')->insert($rows);
                        $rows = [];
                    }
                }
            }
        }

        if ($rows !== []) {
            DB::table('time_entries')->insert($rows);
        }

        $this->command?->info(
            "Seeded benchmark organization #{$organization->id} with "
            .count($userIds)." employees and {$created} time entries."
        );
    }
}
