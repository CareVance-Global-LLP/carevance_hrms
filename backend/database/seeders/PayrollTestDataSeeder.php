<?php

namespace Database\Seeders;

use App\Models\Group;
use App\Models\User;
use App\Models\Organization;
use App\Models\EmployeeProfile;
use App\Models\EmployeeWorkInfo;
use App\Models\EmployeeBankAccount;
use App\Models\EmployeePayrollTemplate;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class PayrollTestDataSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        $this->command->info('Creating payroll test data...');

        // Get or create organization
        $organization = Organization::first();
        
        if (!$organization) {
            $organization = Organization::create([
                'name' => 'Test Organization',
                'email' => 'admin@test.com',
                'settings' => [
                    'payroll' => [
                        'defaultBasicPercentage' => 40,
                        'defaultHraPercentage' => 50,
                        'defaultConveyance' => 1600,
                    ]
                ]
            ]);
            $this->command->info("Created organization: {$organization->name}");
        }

        // Create departments if not exist
        $departments = [
            ['name' => 'Digital Marketing', 'code' => 'DM'],
            ['name' => 'IT', 'code' => 'IT'],
            ['name' => 'Quality Assurance', 'code' => 'QA'],
        ];

        $deptIds = [];
        foreach ($departments as $dept) {
            $group = Group::firstOrCreate(
                [
                    'organization_id' => $organization->id,
                    'name' => $dept['name'],
                ],
                [
                    'code' => $dept['code'],
                    'is_active' => true,
                ]
            );
            $deptIds[$dept['name']] = $group->id;
            $this->command->info("Department: {$dept['name']} (ID: {$group->id})");
        }

        // Create test employees for each department
        $employees = [
            // Digital Marketing - 3 employees
            [
                'name' => 'Rahul Sharma',
                'email' => 'rahul.sharma@test.com',
                'department' => 'Digital Marketing',
                'designation' => 'Marketing Executive',
                'annual_ctc' => 600000,
            ],
            [
                'name' => 'Priya Patel',
                'email' => 'priya.patel@test.com',
                'department' => 'Digital Marketing',
                'designation' => 'SEO Specialist',
                'annual_ctc' => 720000,
            ],
            [
                'name' => 'Amit Kumar',
                'email' => 'amit.kumar@test.com',
                'department' => 'Digital Marketing',
                'designation' => 'Content Writer',
                'annual_ctc' => 480000,
            ],
            // IT - 1 employee
            [
                'name' => 'Sneha Gupta',
                'email' => 'sneha.gupta@test.com',
                'department' => 'IT',
                'designation' => 'Software Developer',
                'annual_ctc' => 1200000,
            ],
            // Quality Assurance - 3 employees
            [
                'name' => 'Vikram Rao',
                'email' => 'vikram.rao@test.com',
                'department' => 'Quality Assurance',
                'designation' => 'QA Lead',
                'annual_ctc' => 960000,
            ],
            [
                'name' => 'Neha Singh',
                'email' => 'neha.singh@test.com',
                'department' => 'Quality Assurance',
                'designation' => 'QA Engineer',
                'annual_ctc' => 840000,
            ],
            [
                'name' => 'Arun Verma',
                'email' => 'arun.verma@test.com',
                'department' => 'Quality Assurance',
                'designation' => 'Test Engineer',
                'annual_ctc' => 660000,
            ],
            // Unassigned - 1 employee
            [
                'name' => 'Kiran Desai',
                'email' => 'kiran.desai@test.com',
                'department' => null,
                'designation' => 'Trainee',
                'annual_ctc' => 360000,
            ],
        ];

        foreach ($employees as $index => $empData) {
            // Check if user already exists
            $existingUser = User::where('email', $empData['email'])->first();
            
            if ($existingUser) {
                $user = $existingUser;
                $this->command->info("Using existing user: {$user->name}");
            } else {
                // Create user
                $user = User::create([
                    'organization_id' => $organization->id,
                    'name' => $empData['name'],
                    'email' => $empData['email'],
                    'password' => Hash::make('password123'),
                    'role' => 'employee',
                    'is_active' => true,
                ]);
                $this->command->info("Created user: {$user->name}");
            }

            // Create employee profile
            EmployeeProfile::firstOrCreate(
                ['user_id' => $user->id],
                [
                    'organization_id' => $organization->id,
                    'pan_number' => 'ABCDE' . str_pad($index + 1000, 4, '0', STR_PAD_LEFT) . 'F',
                    'uan_number' => strval(100000000000 + $index),
                    'esi_ip_number' => '1234567890' . str_pad($index, 7, '0', STR_PAD_LEFT),
                    'tax_regime' => 'new',
                    'is_metro_city' => true,
                    'pt_state' => 'maharashtra',
                ]
            );

            // Create employee work info
            EmployeeWorkInfo::firstOrCreate(
                ['user_id' => $user->id],
                [
                    'employee_code' => 'EMP' . str_pad($user->id, 4, '0', STR_PAD_LEFT),
                    'designation' => $empData['designation'],
                    'joining_date' => now()->subYears(rand(1, 5))->subMonths(rand(0, 11))->format('Y-m-d'),
                ]
            );

            // Create bank account
            EmployeeBankAccount::firstOrCreate(
                [
                    'user_id' => $user->id,
                    'is_primary' => true,
                ],
                [
                    'account_number' => '1234567890' . str_pad($user->id, 4, '0', STR_PAD_LEFT),
                    'ifsc_swift' => 'HDFC0001234',
                    'bank_name' => 'HDFC Bank',
                    'account_holder_name' => $user->name,
                ]
            );

            // Create payroll template
            $template = EmployeePayrollTemplate::firstOrCreate(
                [
                    'user_id' => $user->id,
                    'organization_id' => $organization->id,
                ],
                [
                    'annual_ctc' => $empData['annual_ctc'],
                    'basic_percentage' => 40,
                    'hra_percentage' => 50,
                    'conveyance_allowance' => 1600,
                    'medical_allowance' => 1250,
                    'pf_enabled' => true,
                    'esi_enabled' => true,
                    'pt_enabled' => true,
                    'tds_enabled' => true,
                    'tax_regime' => 'new',
                    'is_metro_city' => true,
                    'pt_state' => 'maharashtra',
                ]
            );

            // Assign to department
            if ($empData['department'] && isset($deptIds[$empData['department']])) {
                $deptId = $deptIds[$empData['department']];
                
                // Check if already assigned
                $existingAssignment = DB::table('group_user')
                    ->where('group_id', $deptId)
                    ->where('user_id', $user->id)
                    ->first();
                
                if (!$existingAssignment) {
                    DB::table('group_user')->insert([
                        'group_id' => $deptId,
                        'user_id' => $user->id,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]);
                    $this->command->info("Assigned {$user->name} to {$empData['department']}");
                }
            }
        }

        // Create an admin user
        $admin = User::firstOrCreate(
            ['email' => 'admin@company.com'],
            [
                'organization_id' => $organization->id,
                'name' => 'System Administrator',
                'password' => Hash::make('admin123'),
                'role' => 'admin',
                'is_active' => true,
            ]
        );

        // Assign admin to IT department
        $itDeptId = $deptIds['IT'] ?? null;
        if ($itDeptId) {
            $existingAssignment = DB::table('group_user')
                ->where('group_id', $itDeptId)
                ->where('user_id', $admin->id)
                ->first();
            
            if (!$existingAssignment) {
                DB::table('group_user')->insert([
                    'group_id' => $itDeptId,
                    'user_id' => $admin->id,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }
        }

        $this->command->info('');
        $this->command->info('✅ Payroll test data created successfully!');
        $this->command->info('');
        $this->command->info('Test Employee Credentials:');
        $this->command->info('-------------------------');
        foreach ($employees as $emp) {
            $this->command->info("Email: {$emp['email']}");
        }
        $this->command->info('');
        $this->command->info('Admin Credentials:');
        $this->command->info('------------------');
        $this->command->info('Email: admin@company.com');
        $this->command->info('Password: admin123');
        $this->command->info('');
    }
}
