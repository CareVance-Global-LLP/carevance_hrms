<?php

namespace Tests\Concerns;

use App\Models\EmployeePayrollTemplate;
use App\Models\Group;
use App\Models\Organization;
use App\Models\User;

/**
 * The shared payroll fixture: one organization, one department, the four roles
 * payroll cares about, and the profile / work info / bank account rows that
 * anything money-shaped reads.
 *
 * A trait rather than a base class on purpose. This started as
 * PayrollIntegrationTest's setUp, and the obvious way to reuse it was to extend
 * that class — which silently re-runs all fifteen of its tests under a second
 * name, doubling the suite and reporting duplicate results.
 */
trait BuildsPayrollFixture
{
    protected Organization $organization;
    protected Group $department;
    protected User $employee;
    protected User $manager;
    protected User $admin;
    protected User $hr;

    protected function buildPayrollFixture(): void
    {
        $this->organization = Organization::factory()->create([
            'name' => 'Test Organization',
            'settings' => [
                'payroll' => [
                    'defaultBasicPercentage' => 40,
                    'defaultHraPercentage' => 50,
                    'defaultConveyance' => 1600,
                    'pfEnabled' => true,
                    'esiEnabled' => true,
                    'ptEnabled' => true,
                    'tdsEnabled' => true,
                ],
            ],
        ]);

        $this->department = Group::factory()->create([
            'organization_id' => $this->organization->id,
            'name' => 'Engineering',
        ]);

        $this->createUsers();
        $this->createEmployeeProfiles();

        \DB::table('group_user')->insert([
            'group_id' => $this->department->id,
            'user_id' => $this->employee->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function createUsers(): void
    {
        $this->admin = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
            'name' => 'Admin User',
            'email' => 'admin@company.com',
        ]);

        $this->hr = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'hr',
            'name' => 'HR Manager',
            'email' => 'hr@company.com',
        ]);

        $this->manager = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'manager',
            'name' => 'Department Manager',
            'email' => 'manager@company.com',
        ]);

        $this->employee = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
            'name' => 'Test Employee',
            'email' => 'employee@company.com',
        ]);
    }

    private function createEmployeeProfiles(): void
    {
        foreach ([$this->employee, $this->manager, $this->hr, $this->admin] as $user) {
            \App\Models\EmployeeProfile::factory()->create([
                'user_id' => $user->id,
                'organization_id' => $this->organization->id,
                'pan_number' => 'ABCDE1234F',
                'uan_number' => '123456789012',
                'esi_ip_number' => '12345678901234567',
                'tax_regime' => 'new',
                'is_metro_city' => true,
                'pt_state' => 'maharashtra',
            ]);

            \App\Models\EmployeeWorkInfo::factory()->create([
                'user_id' => $user->id,
                // Without this the factory mints a NEW organization, the global
                // scope hides the row, and every test runs against an employee
                // who silently has no work info at all.
                'organization_id' => $this->organization->id,
                'employee_code' => 'EMP'.str_pad($user->id, 4, '0', STR_PAD_LEFT),
                'designation' => 'Software Engineer',
                'joining_date' => now()->subYears(2)->format('Y-m-d'),
            ]);

            \App\Models\EmployeeBankAccount::factory()->create([
                'user_id' => $user->id,
                // Same trap as the work info above: the factory would otherwise
                // mint a new organization and the scope would hide the account,
                // making every fixture employee look unbanked.
                'organization_id' => $this->organization->id,
                'account_number' => '1234567890'.$user->id,
                'ifsc_swift' => 'HDFC0001234',
                'bank_name' => 'HDFC Bank',
                // The column is is_default (see the create_employee_workspace_tables
                // migration and EmployeeBankAccount::$fillable). is_primary was a
                // stale name that silently failed the insert.
                'is_default' => true,
            ]);
        }
    }

    /**
     * Give a user a CTC on their payroll template.
     *
     * Several payroll operations refuse to run without one — leave encashment
     * and F&F both compute from it, and run processing skips anyone who has
     * none. The fixture above sets up the profile, work info and bank account
     * but no template, so anything money-shaped has to ask for this explicitly.
     */
    protected function giveCtc(User $user, float $annualCtc = 1200000): void
    {
        EmployeePayrollTemplate::getOrCreateForUser($user->id, $this->organization->id);

        \DB::table('employee_payroll_templates')
            ->where('user_id', $user->id)
            ->update(['annual_ctc' => $annualCtc]);
    }
}
