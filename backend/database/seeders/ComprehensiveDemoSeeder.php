<?php

namespace Database\Seeders;

use App\Models\Organization;
use App\Models\User;
use App\Models\Group;
use App\Models\Project;
use App\Models\Task;
use App\Models\TimeEntry;
use App\Models\Activity;
use App\Models\Screenshot;
use App\Models\Invoice;
use App\Models\InvoiceItem;
use App\Models\AttendanceRecord;
use App\Models\LeaveRequest;
use App\Models\EmployeeProfile;
use App\Models\EmployeeWorkInfo;
use App\Models\EmployeeBankAccount;
use App\Models\EmployeeDocument;
use App\Models\EmployeeGovernmentId;
use App\Models\PayrollProfile;
use App\Models\SalaryComponent;
use App\Models\SalaryTemplate;
use App\Models\Payslip;
use App\Models\Payroll;
use App\Models\EmployeeLoan;
use App\Models\LeaveEncashment;
use App\Models\ArrearPayment;
use App\Models\FullAndFinalSettlement;
use App\Models\Reimbursement;
use App\Models\Asset;
use App\Models\AssetAssignment;
use App\Models\PerformanceGoal;
use App\Models\PerformanceReview;
use App\Models\EmployeeTaxDeclaration;
use App\Models\FbpComponent;
use App\Models\FbpAllocation;
use App\Models\FbpClaim;
use App\Models\EmployeePerquisite;
use App\Models\Resignation;
use App\Models\BreakTime;
use App\Models\ChatConversation;
use App\Models\ChatMessage;
use App\Models\AppNotification;
use App\Models\EmployeeActivityLog;
use App\Models\TaskLabel;
use App\Models\TaskComment;
use App\Models\TaskChecklistItem;
use App\Models\TaskActivity;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class ComprehensiveDemoSeeder extends Seeder
{
    private Organization $org;
    private array $employees = [];
    private array $managers = [];
    private $admin;
    private $faker;
    private array $approvedLeaveDates = []; // userId => ['YYYY-MM-DD', ...]

    public function run(): void
    {
        $this->faker = \Faker\Factory::create();

        $this->org = Organization::where('slug', 'ayush-company')->first()
            ?? Organization::where('slug', 'carevance-test')->first()
            ?? Organization::first();
        if (!$this->org) {
            $this->command->error('No organization found. Run DatabaseSeeder first.');
            return;
        }

        $this->admin = User::where('organization_id', $this->org->id)->where('role', 'admin')->first();
        $this->employees = User::where('organization_id', $this->org->id)->whereIn('role', ['employee', 'manager'])->get()->toArray();
        $this->managers = User::where('organization_id', $this->org->id)->where('role', 'manager')->get()->toArray();

        if (empty($this->employees)) {
            $this->employees = User::where('organization_id', $this->org->id)->get()->toArray();
        }

        if (empty($this->employees)) {
            $this->command->error('No employees found. Run DatabaseSeeder first.');
            return;
        }

        $this->command->info('Seeding comprehensive demo data for: ' . $this->org->name);

        $this->seedGroups();
        $this->seedProjects();
        $this->seedTaskLabels();
        $this->seedTasks();
        $this->seedLeaveRequests();   // MUST be before attendance/time entries/breaks
        $this->seedTimeEntries();
        $this->seedActivities();
        $this->seedScreenshots();
        $this->seedAttendance();
        $this->seedBreaks();
        $this->seedInvoices();
        $this->seedEmployeeProfiles();
        $this->seedEmployeeWorkInfo();
        $this->seedEmployeeBankAccounts();
        $this->seedEmployeeDocuments();
        $this->seedEmployeeGovernmentIds();
        $this->seedSalaryComponents();
        $this->seedSalaryTemplates();
        $this->seedPayrollProfiles();
        $this->seedPayslips();
        $this->seedPayrolls();
        $this->seedEmployeeLoans();
        $this->seedLeaveEncashments();
        $this->seedArrearPayments();
        $this->seedFnFSettlements();
        $this->seedResignations();
        $this->seedReimbursements();
        $this->seedAssets();
        $this->seedPerformanceGoals();
        $this->seedPerformanceReviews();
        $this->seedTaxDeclarations();
        $this->seedFbpComponents();
        $this->seedFbpAllocations();
        $this->seedFbpClaims();
        $this->seedPerquisites();
        $this->seedChat();
        $this->seedNotifications();
        $this->seedAuditLogs();

        $this->command->info('Comprehensive demo data seeded successfully!');
    }

    private function allUsers(): array
    {
        $users = $this->employees;
        if ($this->admin) $users[] = $this->admin->toArray();
        return $users;
    }

    private function userIds(): array
    {
        return array_column($this->allUsers(), 'id');
    }

    private function empIds(): array
    {
        return array_column($this->employees, 'id');
    }

    private function randomEmpId(): int
    {
        return $this->employees[array_rand($this->employees)]['id'];
    }

    private function randomUserId(): int
    {
        $ids = $this->userIds();
        return $ids[array_rand($ids)];
    }

    // ─── Groups / Departments ───────────────────────────────────────────

    private function seedGroups(): void
    {
        $groups = [
            ['name' => 'Engineering', 'description' => 'Software development and technical teams'],
            ['name' => 'Product', 'description' => 'Product management and design'],
            ['name' => 'Marketing', 'description' => 'Marketing, growth, and brand'],
            ['name' => 'Human Resources', 'description' => 'HR, recruitment, and people ops'],
            ['name' => 'Finance', 'description' => 'Finance, accounting, and compliance'],
            ['name' => 'Sales', 'description' => 'Business development and sales'],
            ['name' => 'Operations', 'description' => 'Operations and logistics'],
            ['name' => 'Customer Success', 'description' => 'Customer support and success'],
        ];

        foreach ($groups as $g) {
            Group::firstOrCreate(
                ['organization_id' => $this->org->id, 'name' => $g['name']],
                ['description' => $g['description']]
            );
        }

        // Assign employees to groups
        $groups = Group::where('organization_id', $this->org->id)->get();
        foreach ($this->employees as $i => $emp) {
            $group = $groups[$i % $groups->count()];
            if (!$group->users()->where('user_id', $emp['id'])->exists()) {
                $group->users()->attach($emp['id']);
            }
        }

        $this->command->info('  ✓ Groups seeded');
    }

    // ─── Projects ───────────────────────────────────────────────────────

    private function seedProjects(): void
    {
        $projects = [
            ['name' => 'Website Redesign', 'description' => 'Complete overhaul of the corporate website with new design system', 'budget' => 150000, 'status' => 'active'],
            ['name' => 'Mobile App v2', 'description' => 'Native mobile app rebuild for iOS and Android', 'budget' => 500000, 'status' => 'active'],
            ['name' => 'Data Migration', 'description' => 'Migrate legacy data to new cloud infrastructure', 'budget' => 80000, 'status' => 'active'],
            ['name' => 'AI Chatbot Integration', 'description' => 'Integrate AI-powered customer support chatbot', 'budget' => 200000, 'status' => 'active'],
            ['name' => 'Security Audit Q2', 'description' => 'Quarterly security audit and penetration testing', 'budget' => 50000, 'status' => 'completed'],
            ['name' => 'HR Portal', 'description' => 'Internal HR self-service portal', 'budget' => 120000, 'status' => 'active'],
            ['name' => 'Payment Gateway v3', 'description' => 'Upgrade payment processing to support international payments', 'budget' => 300000, 'status' => 'active'],
            ['name' => 'Analytics Dashboard', 'description' => 'Real-time analytics and reporting dashboard', 'budget' => 90000, 'status' => 'active'],
            ['name' => 'API Documentation', 'description' => 'Comprehensive API docs with interactive examples', 'budget' => 30000, 'status' => 'completed'],
            ['name' => 'DevOps Pipeline', 'description' => 'CI/CD pipeline automation and monitoring', 'budget' => 60000, 'status' => 'active'],
        ];

        $projectIds = [];
        foreach ($projects as $p) {
            $proj = Project::firstOrCreate(
                ['organization_id' => $this->org->id, 'name' => $p['name']],
                [
                    'description' => $p['description'],
                    'budget' => $p['budget'],
                    'status' => $p['status'],
                    'deadline' => $this->faker->dateTimeBetween('+1 month', '+6 months')->format('Y-m-d'),
                ]
            );
            $projectIds[] = $proj->id;

            // Assign random employees
            $assignCount = rand(2, 5);
            $empIds = $this->empIds();
            shuffle($empIds);
            $proj->assignedUsers()->syncWithoutDetaching(array_slice($empIds, 0, $assignCount));
        }

        $this->projectIds = $projectIds;
        $this->command->info('  ✓ Projects seeded');
    }

    // ─── Task Labels ────────────────────────────────────────────────────

    private function seedTaskLabels(): void
    {
        $labels = [
            ['name' => 'Bug', 'color' => '#ef4444'],
            ['name' => 'Feature', 'color' => '#3b82f6'],
            ['name' => 'Enhancement', 'color' => '#8b5cf6'],
            ['name' => 'Documentation', 'color' => '#06b6d4'],
            ['name' => 'Urgent', 'color' => '#f97316'],
            ['name' => 'Backend', 'color' => '#10b981'],
            ['name' => 'Frontend', 'color' => '#ec4899'],
            ['name' => 'DevOps', 'color' => '#6366f1'],
            ['name' => 'Design', 'color' => '#a855f7'],
            ['name' => 'Testing', 'color' => '#eab308'],
            ['name' => 'Refactor', 'color' => '#14b8a6'],
            ['name' => 'Performance', 'color' => '#f43f5e'],
        ];

        foreach ($labels as $l) {
            TaskLabel::firstOrCreate(
                ['organization_id' => $this->org->id, 'name' => $l['name']],
                ['color' => $l['color']]
            );
        }
        $this->command->info('  ✓ Task labels seeded');
    }

    // ─── Tasks ──────────────────────────────────────────────────────────

    private function seedTasks(): void
    {
        $taskTitles = [
            'Implement user authentication flow',
            'Design landing page wireframes',
            'Set up CI/CD pipeline',
            'Write unit tests for API endpoints',
            'Optimize database queries',
            'Create employee onboarding wizard',
            'Build notification system',
            'Implement file upload service',
            'Add two-factor authentication',
            'Create dashboard analytics widgets',
            'Fix responsive layout on mobile',
            'Integrate payment gateway',
            'Write API documentation',
            'Set up monitoring alerts',
            'Implement role-based access control',
            'Create email template system',
            'Build search functionality',
            'Implement data export feature',
            'Add real-time chat support',
            'Create automated backup system',
            'Fix memory leak in worker process',
            'Implement SSO integration',
            'Build reporting module',
            'Create onboarding email sequence',
            'Optimize image compression',
            'Implement webhook system',
            'Build audit log viewer',
            'Create custom field builder',
            'Implement batch operations',
            'Build drag-and-drop file manager',
        ];

        $statuses = ['todo', 'in_progress', 'done'];
        $projectIds = $this->projectIds ?? Project::where('organization_id', $this->org->id)->pluck('id')->toArray();
        $labelIds = TaskLabel::where('organization_id', $this->org->id)->pluck('id')->toArray();
        $this->taskIds = [];

        foreach ($taskTitles as $title) {
            $projectId = $projectIds[array_rand($projectIds)];
            $status = $statuses[array_rand($statuses)];
            $task = Task::create([
                'project_id' => $projectId,
                'assignee_id' => $this->randomEmpId(),
                'title' => $title,
                'description' => $this->faker->sentence(10),
                'status' => $status,
                'due_date' => $this->faker->dateTimeBetween('-1 month', '+3 months')->format('Y-m-d'),
            ]);
            $this->taskIds[] = $task->id;

            // Attach random labels
            if ($labelIds) {
                shuffle($labelIds);
                $task->labels()->sync(array_slice($labelIds, 0, rand(1, 3)));
            }

            // Checklist items
            $checkCount = rand(2, 5);
            for ($c = 0; $c < $checkCount; $c++) {
                TaskChecklistItem::create([
                    'task_id' => $task->id,
                    'title' => $this->faker->sentence(4),
                    'is_completed' => $this->faker->boolean(30),
                    'position' => $c,
                ]);
            }

            // Comments
            $commentCount = rand(0, 4);
            for ($c = 0; $c < $commentCount; $c++) {
                TaskComment::create([
                    'task_id' => $task->id,
                    'user_id' => $this->randomUserId(),
                    'content' => $this->faker->paragraph(1),
                ]);
            }

            // Task activities
            $activityCount = rand(1, 3);
            $actions = ['created', 'status_changed', 'assigned', 'comment_added', 'label_added'];
            for ($a = 0; $a < $activityCount; $a++) {
                TaskActivity::create([
                    'task_id' => $task->id,
                    'actor_id' => $this->randomUserId(),
                    'action' => $actions[array_rand($actions)],
                    'description' => $this->faker->sentence(6),
                ]);
            }
        }

        $this->command->info('  ✓ Tasks seeded (with labels, comments, checklists, activities)');
    }

    // ─── Time Entries ───────────────────────────────────────────────────

    private function seedTimeEntries(): void
    {
        $projectIds = $this->projectIds ?? Project::where('organization_id', $this->org->id)->pluck('id')->toArray();
        $taskIds = $this->taskIds ?? Task::pluck('id')->toArray();
        $descriptions = [
            'Working on frontend components',
            'Backend API development',
            'Code review and bug fixes',
            'Database optimization',
            'Writing unit tests',
            'Meeting with stakeholders',
            'Debugging production issue',
            'Implementing new feature',
            'Refactoring legacy code',
            'Setting up development environment',
            'Documentation updates',
            'Performance testing',
            'Security patch implementation',
            'Deploying to staging',
            'Pair programming session',
        ];

        $count = 0;
        foreach ($this->employees as $emp) {
            $leaveDates = $this->approvedLeaveDates[$emp['id']] ?? [];
            $entryCount = rand(15, 30);
            $attempts = 0;
            $created = 0;
            while ($created < $entryCount && $attempts < $entryCount * 3) {
                $attempts++;
                $date = $this->faker->dateTimeBetween('-30 days', 'now');
                $dateStr = $date->format('Y-m-d');

                // Skip if employee is on approved leave this day
                if (in_array($dateStr, $leaveDates)) continue;

                $startHour = rand(9, 14);
                $start = (clone $date)->setTime($startHour, rand(0, 59));
                $durationHours = rand(1, 6);
                $end = (clone $start)->modify("+{$durationHours} hours");

                TimeEntry::create([
                    'user_id' => $emp['id'],
                    'task_id' => $taskIds[array_rand($taskIds)],
                    'project_id' => $projectIds[array_rand($projectIds)],
                    'start_time' => $start->format('Y-m-d H:i:s'),
                    'end_time' => $end->format('Y-m-d H:i:s'),
                    'duration' => $durationHours * 3600,
                    'description' => $descriptions[array_rand($descriptions)],
                    'billable' => $this->faker->boolean(70),
                ]);
                $count++;
                $created++;
            }
        }
        $this->command->info("  ✓ Time entries seeded ({$count} entries)");
    }

    // ─── Activities ─────────────────────────────────────────────────────

    private function seedActivities(): void
    {
        $types = ['commits', 'code_reviews', 'deploys', 'meetings', 'breaks',
            'focus_time', 'research', 'planning', 'documentation', 'learning'];
        $names = [
            'VS Code', 'Chrome', 'Slack', 'GitHub', 'Jira',
            'Terminal', 'Figma', 'Notion', 'Teams', 'Postman',
        ];
        $count = 0;
        foreach ($this->employees as $emp) {
            for ($i = 0; $i < 20; $i++) {
                $date = $this->faker->dateTimeBetween('-30 days', 'now');
                Activity::create([
                    'user_id' => $emp['id'],
                    'type' => $types[array_rand($types)],
                    'name' => $names[array_rand($names)],
                    'duration' => rand(300, 7200),
                    'recorded_at' => $date->format('Y-m-d H:i:s'),
                ]);
                $count++;
            }
        }
        $this->command->info("  ✓ Activities seeded ({$count} entries)");
    }

    // ─── Screenshots ────────────────────────────────────────────────────

    private function seedScreenshots(): void
    {
        $timeEntries = TimeEntry::where('user_id', array_column($this->employees, 'id'))->pluck('id')->toArray();
        if (empty($timeEntries)) {
            $this->command->info('  ✓ Screenshots skipped (no time entries)');
            return;
        }
        $count = 0;
        foreach ($this->employees as $emp) {
            for ($i = 0; $i < 10; $i++) {
                $date = $this->faker->dateTimeBetween('-14 days', 'now');
                $teId = $timeEntries[array_rand($timeEntries)];
                Screenshot::create([
                    'time_entry_id' => $teId,
                    'filename' => 'screenshot-' . $date->format('Ymd-His') . '.jpg',
                    'captured_at' => $date->format('Y-m-d H:i:s'),
                ]);
                $count++;
            }
        }
        $this->command->info("  ✓ Screenshots seeded ({$count} entries)");
    }

    // ─── Attendance ─────────────────────────────────────────────────────

    private function seedAttendance(): void
    {
        $statuses = ['present', 'absent', 'late', 'half_day', 'work_from_home', 'holiday'];
        $count = 0;
        foreach ($this->employees as $emp) {
            $leaveDates = $this->approvedLeaveDates[$emp['id']] ?? [];
            for ($d = 30; $d >= 0; $d--) {
                $date = now()->subDays($d);
                if ($date->isWeekend()) continue;

                $dateStr = $date->format('Y-m-d');
                // Skip if employee is on approved leave this day
                if (in_array($dateStr, $leaveDates)) {
                    AttendanceRecord::updateOrCreate(
                        ['user_id' => $emp['id'], 'attendance_date' => $dateStr],
                        [
                            'organization_id' => $this->org->id,
                            'check_in_at' => null,
                            'check_out_at' => null,
                            'worked_seconds' => 0,
                            'late_minutes' => 0,
                            'status' => 'on_leave',
                        ]
                    );
                    $count++;
                    continue;
                }

                $status = $statuses[array_rand($statuses)];
                $checkIn = $status !== 'absent' ? $date->copy()->setTime(rand(8, 10), rand(0, 59)) : null;
                $checkOut = $checkIn && $status !== 'absent' ? $checkIn->copy()->addHours(rand(7, 9))->addMinutes(rand(0, 59)) : null;
                $worked = $checkIn && $checkOut ? (int) $checkIn->diffInSeconds($checkOut) : 0;

                AttendanceRecord::updateOrCreate(
                    ['user_id' => $emp['id'], 'attendance_date' => $dateStr],
                    [
                        'organization_id' => $this->org->id,
                        'check_in_at' => $checkIn?->format('Y-m-d H:i:s'),
                        'check_out_at' => $checkOut?->format('Y-m-d H:i:s'),
                        'worked_seconds' => $worked,
                        'late_minutes' => $status === 'late' ? rand(5, 60) : 0,
                        'status' => $status,
                    ]
                );
                $count++;
            }
        }
        $this->command->info("  ✓ Attendance seeded ({$count} records)");
    }

    // ─── Breaks ─────────────────────────────────────────────────────────

    private function seedBreaks(): void
    {
        $reasons = ['Lunch', 'Tea break', 'Personal', 'Walk', 'Meeting break', 'Prayer'];
        $count = 0;
        foreach ($this->employees as $emp) {
            $leaveDates = $this->approvedLeaveDates[$emp['id']] ?? [];
            for ($d = 14; $d >= 0; $d--) {
                $date = now()->subDays($d);
                if ($date->isWeekend()) continue;

                $dateStr = $date->format('Y-m-d');
                // Skip if employee is on approved leave this day
                if (in_array($dateStr, $leaveDates)) continue;

                $breakCount = rand(1, 3);
                for ($b = 0; $b < $breakCount; $b++) {
                    $start = $date->copy()->setTime(rand(10, 16), rand(0, 59));
                    $dur = rand(10, 60) * 60;
                    BreakTime::create([
                        'organization_id' => $this->org->id,
                        'user_id' => $emp['id'],
                        'break_date' => $dateStr,
                        'start_at' => $start->format('Y-m-d H:i:s'),
                        'end_at' => $start->copy()->addSeconds($dur)->format('Y-m-d H:i:s'),
                        'duration_seconds' => $dur,
                        'reason' => $reasons[array_rand($reasons)],
                    ]);
                    $count++;
                }
            }
        }
        $this->command->info("  ✓ Breaks seeded ({$count} entries)");
    }

    // ─── Leave Requests ─────────────────────────────────────────────────

    private function seedLeaveRequests(): void
    {
        $reasons = [
            'Family function', 'Medical appointment', 'Personal work',
            'Vacation', 'Family emergency', 'Relocation', 'Wedding',
            'Medical leave', 'Mental health day', 'Child care',
        ];
        $statuses = ['pending', 'approved', 'rejected'];
        $count = 0;

        // Build approved leave dates map so attendance/time entries/breaks skip them
        $this->approvedLeaveDates = [];

        foreach ($this->employees as $emp) {
            $this->approvedLeaveDates[$emp['id']] = [];
            $leaveCount = rand(2, 5);
            for ($l = 0; $l < $leaveCount; $l++) {
                $start = $this->faker->dateTimeBetween('-60 days', '+30 days');
                $end = (clone $start)->modify('+' . rand(1, 5) . ' days');
                $status = $statuses[array_rand($statuses)];

                LeaveRequest::create([
                    'organization_id' => $this->org->id,
                    'user_id' => $emp['id'],
                    'start_date' => $start->format('Y-m-d'),
                    'end_date' => $end->format('Y-m-d'),
                    'reason' => $reasons[array_rand($reasons)],
                    'status' => $status,
                    'reviewed_by' => $status !== 'pending' ? $this->admin?->id : null,
                    'reviewed_at' => $status !== 'pending' ? now()->subDays(rand(1, 10)) : null,
                    'review_note' => $status === 'approved' ? 'Approved' : ($status === 'rejected' ? 'Insufficient balance' : null),
                ]);

                // Track approved leave dates so attendance/time entries/breaks skip them
                if ($status === 'approved') {
                    $cursor = (clone $start);
                    while ($cursor <= $end) {
                        $this->approvedLeaveDates[$emp['id']][] = $cursor->format('Y-m-d');
                        $cursor->modify('+1 day');
                    }
                }
                $count++;
            }
        }
        $this->command->info("  ✓ Leave requests seeded ({$count} entries)");
    }

    // ─── Invoices ───────────────────────────────────────────────────────

    private function seedInvoices(): void
    {
        $clients = [
            ['name' => 'Acme Corp', 'email' => 'billing@acme.com', 'address' => '123 Business Ave, Mumbai'],
            ['name' => 'TechStart Inc', 'email' => 'pay@techstart.io', 'address' => '456 Innovation Blvd, Bangalore'],
            ['name' => 'GlobalServ', 'email' => 'accounts@globalserv.com', 'address' => '789 Enterprise St, Delhi'],
            ['name' => 'NexGen Solutions', 'email' => 'finance@nexgen.dev', 'address' => '321 Startup Lane, Pune'],
            ['name' => 'CloudNine Labs', 'email' => 'ap@cloudnine.io', 'address' => '654 Tech Park, Hyderabad'],
        ];
        $statuses = ['draft', 'sent', 'paid', 'overdue', 'cancelled'];
        $maxInvoice = \DB::table('invoices')->where('organization_id', $this->org->id)
            ->selectRaw("invoice_number")
            ->orderByDesc('id')->value('invoice_number');
        preg_match('/(\d+)$/', $maxInvoice ?? '0', $m);
        $startNum = max(1, (int)($m[1] ?? 0) + 1);

        $count = 0;
        foreach ($clients as $i => $client) {
            $subtotal = rand(50000, 500000);
            $tax = $subtotal * 0.18;
            $status = $statuses[array_rand($statuses)];
            $inv = Invoice::create([
                'organization_id' => $this->org->id,
                'invoice_number' => 'INV-2026-' . str_pad($startNum + $i, 4, '0', STR_PAD_LEFT),
                'client_name' => $client['name'],
                'client_email' => $client['email'],
                'client_address' => $client['address'],
                'subtotal' => $subtotal,
                'tax' => $tax,
                'total' => $subtotal + $tax,
                'status' => $status,
                'due_date' => $this->faker->dateTimeBetween('+7 days', '+60 days')->format('Y-m-d'),
                'paid_at' => $status === 'paid' ? $this->faker->dateTimeBetween('-30 days', 'now')->format('Y-m-d') : null,
            ]);

            // Invoice items
            $itemCount = rand(2, 5);
            for ($it = 0; $it < $itemCount; $it++) {
                $hours = rand(1, 40);
                $rate = rand(1000, 5000);
                InvoiceItem::create([
                    'invoice_id' => $inv->id,
                    'description' => $this->faker->sentence(3),
                    'hours' => $hours,
                    'rate' => $rate,
                    'amount' => $hours * $rate,
                ]);
            }
            $count++;
        }
        $this->command->info("  ✓ Invoices seeded ({$count} with line items)");
    }

    // ─── Employee Profiles ──────────────────────────────────────────────

    private function seedEmployeeProfiles(): void
    {
        $cities = [
            ['city' => 'Mumbai', 'state' => 'Maharashtra', 'postal' => '400001'],
            ['city' => 'Bangalore', 'state' => 'Karnataka', 'postal' => '560001'],
            ['city' => 'Delhi', 'state' => 'Delhi', 'postal' => '110001'],
            ['city' => 'Pune', 'state' => 'Maharashtra', 'postal' => '411001'],
            ['city' => 'Hyderabad', 'state' => 'Telangana', 'postal' => '500001'],
            ['city' => 'Chennai', 'state' => 'Tamil Nadu', 'postal' => '600001'],
            ['city' => 'Kolkata', 'state' => 'West Bengal', 'postal' => '700001'],
            ['city' => 'Ahmedabad', 'state' => 'Gujarat', 'postal' => '380001'],
        ];
        $relationships = ['Spouse', 'Parent', 'Sibling', 'Child', 'Friend'];
        $genders = ['male', 'female', 'other'];

        foreach ($this->employees as $emp) {
            $nameParts = explode(' ', $emp['name']);
            $firstName = $nameParts[0] ?? $emp['name'];
            $lastName = $nameParts[1] ?? '';
            $loc = $cities[array_rand($cities)];

            EmployeeProfile::updateOrCreate(
                ['organization_id' => $this->org->id, 'user_id' => $emp['id']],
                [
                    'first_name' => $firstName,
                    'last_name' => $lastName,
                    'display_name' => $emp['name'],
                    'gender' => $genders[array_rand($genders)],
                    'date_of_birth' => $this->faker->dateTimeBetween('-40 years', '-22 years')->format('Y-m-d'),
                    'phone' => '+91' . $this->faker->numerify('##########'),
                    'personal_email' => strtolower($firstName) . '.' . strtolower($lastName ?: 'emp') . '@personal.com',
                    'address_line' => $this->faker->streetAddress(),
                    'city' => $loc['city'],
                    'state' => $loc['state'],
                    'postal_code' => $loc['postal'],
                    'emergency_contact_name' => $this->faker->name(),
                    'emergency_contact_number' => '+91' . $this->faker->numerify('##########'),
                    'emergency_contact_relationship' => $relationships[array_rand($relationships)],
                ]
            );
        }
        $this->command->info('  ✓ Employee profiles seeded');
    }

    // ─── Employee Work Info ─────────────────────────────────────────────

    private function seedEmployeeWorkInfo(): void
    {
        $designations = [
            'Software Engineer', 'Senior Software Engineer', 'Tech Lead',
            'Product Manager', 'UX Designer', 'QA Engineer',
            'DevOps Engineer', 'Data Analyst', 'Marketing Manager',
            'HR Manager', 'Sales Executive', 'Business Analyst',
        ];
        $locations = ['Office - Mumbai', 'Office - Bangalore', 'Remote', 'Hybrid', 'Office - Delhi'];
        $shifts = ['General (9:30-18:30)', 'Early (8:00-17:00)', 'Late (11:00-20:00)', 'Flexible'];
        $empTypes = ['full_time', 'part_time', 'contract', 'intern'];
        $probation = ['confirmed', 'on_probation', 'extended'];
        $workModes = ['office', 'remote', 'hybrid'];

        foreach ($this->employees as $i => $emp) {
            EmployeeWorkInfo::updateOrCreate(
                ['organization_id' => $this->org->id, 'user_id' => $emp['id']],
                [
                    'employee_code' => 'EMP-' . str_pad($emp['id'], 4, '0', STR_PAD_LEFT),
                    'designation' => $designations[array_rand($designations)],
                    'reporting_manager_id' => $this->admin?->id,
                    'work_location' => $locations[array_rand($locations)],
                    'shift_name' => $shifts[array_rand($shifts)],
                    'attendance_policy' => 'Standard',
                    'employment_type' => $empTypes[array_rand($empTypes)],
                    'joining_date' => $this->faker->dateTimeBetween('-3 years', '-3 months')->format('Y-m-d'),
                    'probation_status' => $probation[array_rand($probation)],
                    'employment_status' => 'active',
                    'work_mode' => $workModes[array_rand($workModes)],
                ]
            );
        }
        $this->command->info('  ✓ Employee work info seeded');
    }

    // ─── Employee Bank Accounts ─────────────────────────────────────────

    private function seedEmployeeBankAccounts(): void
    {
        $banks = ['HDFC Bank', 'ICICI Bank', 'State Bank of India', 'Axis Bank', 'Kotak Mahindra Bank', 'Punjab National Bank'];
        $branches = ['Main Branch', 'Corporate Branch', 'City Center Branch', 'Tech Park Branch', 'Fort Branch'];

        foreach ($this->employees as $emp) {
            $nameParts = explode(' ', $emp['name']);
            EmployeeBankAccount::updateOrCreate(
                ['organization_id' => $this->org->id, 'user_id' => $emp['id'], 'is_default' => true],
                [
                    'account_holder_name' => $emp['name'],
                    'bank_name' => $banks[array_rand($banks)],
                    'account_number' => $this->faker->numerify('##############'),
                    'ifsc_swift' => strtoupper($this->faker->bothify('####?####')),
                    'branch' => $branches[array_rand($branches)],
                    'account_type' => $this->faker->randomElement(['savings', 'current']),
                    'upi_id' => strtolower($nameParts[0] ?? 'user') . '@upi',
                    'payout_method' => 'bank_transfer',
                    'is_default' => true,
                    'verification_status' => $this->faker->randomElement(['verified', 'unverified']),
                ]
            );
        }
        $this->command->info('  ✓ Employee bank accounts seeded');
    }

    // ─── Employee Documents ─────────────────────────────────────────────

    private function seedEmployeeDocuments(): void
    {
        $docTypes = [
            ['title' => 'Offer Letter', 'category' => 'offer_letter'],
            ['title' => 'Resume', 'category' => 'resume'],
            ['title' => 'ID Proof', 'category' => 'id_proof'],
            ['title' => 'Address Proof', 'category' => 'address_proof'],
            ['title' => 'Experience Letter', 'category' => 'experience_letter'],
            ['title' => 'Relieving Letter', 'category' => 'relieving_letter'],
            ['title' => 'Education Certificates', 'category' => 'education'],
            ['title' => 'PAN Card', 'category' => 'id_proof'],
            ['title' => 'Aadhaar Card', 'category' => 'id_proof'],
        ];
        $statuses = ['pending', 'approved', 'rejected'];

        foreach ($this->employees as $emp) {
            $docCount = rand(3, 6);
            $usedDocs = [];
            for ($d = 0; $d < $docCount; $d++) {
                $doc = $docTypes[array_rand($docTypes)];
                if (in_array($doc['title'], $usedDocs)) continue;
                $usedDocs[] = $doc['title'];

                EmployeeDocument::create([
                    'organization_id' => $this->org->id,
                    'user_id' => $emp['id'],
                    'title' => $doc['title'],
                    'category' => $doc['category'],
                    'file_path' => '/documents/' . Str::random(20) . '.pdf',
                    'file_name' => strtolower(str_replace(' ', '_', $doc['title'])) . '.pdf',
                    'file_disk' => 'public',
                    'mime_type' => 'application/pdf',
                    'file_size' => rand(10000, 500000),
                    'uploaded_by' => $emp['id'],
                    'uploaded_at' => now()->subDays(rand(1, 60)),
                    'review_status' => $statuses[array_rand($statuses)],
                ]);
            }
        }
        $this->command->info('  ✓ Employee documents seeded');
    }

    // ─── Employee Government IDs ────────────────────────────────────────

    private function seedEmployeeGovernmentIds(): void
    {
        foreach ($this->employees as $emp) {
            // Exactly 1 PAN per employee
            EmployeeGovernmentId::updateOrCreate(
                ['user_id' => $emp['id'], 'id_type' => 'PAN', 'organization_id' => $this->org->id],
                [
                    'id_number' => strtoupper($this->faker->bothify('#####') . $this->faker->randomLetter()),
                    'status' => $this->faker->randomElement(['verified', 'pending']),
                    'issue_date' => $this->faker->dateTimeBetween('-5 years', '-1 year')->format('Y-m-d'),
                    'expiry_date' => $this->faker->dateTimeBetween('+2 years', '+10 years')->format('Y-m-d'),
                ]
            );
            // Exactly 1 Aadhaar per employee
            EmployeeGovernmentId::updateOrCreate(
                ['user_id' => $emp['id'], 'id_type' => 'Aadhaar', 'organization_id' => $this->org->id],
                [
                    'id_number' => $this->faker->numerify('############'),
                    'status' => $this->faker->randomElement(['verified', 'pending']),
                    'issue_date' => $this->faker->dateTimeBetween('-5 years', '-1 year')->format('Y-m-d'),
                    'expiry_date' => $this->faker->dateTimeBetween('+2 years', '+10 years')->format('Y-m-d'),
                ]
            );
        }
        $this->command->info('  ✓ Employee government IDs seeded (1 PAN + 1 Aadhaar each)');
    }

    // ─── Salary Components ──────────────────────────────────────────────

    private function seedSalaryComponents(): void
    {
        $components = [
            ['name' => 'Basic Salary', 'code' => 'BASIC', 'category' => 'basic', 'value_type' => 'percentage', 'default_value' => 40, 'is_taxable' => true],
            ['name' => 'House Rent Allowance', 'code' => 'HRA', 'category' => 'allowance', 'value_type' => 'percentage', 'default_value' => 20, 'is_taxable' => false],
            ['name' => 'Conveyance Allowance', 'code' => 'CONV', 'category' => 'allowance', 'value_type' => 'fixed', 'default_value' => 1600, 'is_taxable' => false],
            ['name' => 'Medical Allowance', 'code' => 'MED', 'category' => 'allowance', 'value_type' => 'fixed', 'default_value' => 1250, 'is_taxable' => false],
            ['name' => 'Special Allowance', 'code' => 'SPL', 'category' => 'allowance', 'value_type' => 'percentage', 'default_value' => 20, 'is_taxable' => true],
            ['name' => 'Performance Bonus', 'code' => 'PERF', 'category' => 'bonus', 'value_type' => 'percentage', 'default_value' => 8.33, 'is_taxable' => true],
            ['name' => 'PF Employer', 'code' => 'PF_ER', 'category' => 'deduction', 'value_type' => 'percentage', 'default_value' => 12, 'is_taxable' => false],
            ['name' => 'PF Employee', 'code' => 'PF_EE', 'category' => 'deduction', 'value_type' => 'percentage', 'default_value' => 12, 'is_taxable' => false],
            ['name' => 'ESI Employer', 'code' => 'ESI_ER', 'category' => 'deduction', 'value_type' => 'percentage', 'default_value' => 3.25, 'is_taxable' => false],
            ['name' => 'ESI Employee', 'code' => 'ESI_EE', 'category' => 'deduction', 'value_type' => 'percentage', 'default_value' => 0.75, 'is_taxable' => false],
            ['name' => 'Professional Tax', 'code' => 'PT', 'category' => 'deduction', 'value_type' => 'fixed', 'default_value' => 200, 'is_taxable' => false],
            ['name' => 'TDS', 'code' => 'TDS', 'category' => 'tax', 'value_type' => 'fixed', 'default_value' => 0, 'is_taxable' => false],
        ];

        foreach ($components as $c) {
            SalaryComponent::updateOrCreate(
                ['organization_id' => $this->org->id, 'code' => $c['code']],
                [
                    'name' => $c['name'],
                    'category' => $c['category'],
                    'value_type' => $c['value_type'],
                    'default_value' => $c['default_value'],
                    'is_taxable' => $c['is_taxable'],
                    'is_active' => true,
                ]
            );
        }
        $this->command->info('  ✓ Salary components seeded');
    }

    // ─── Salary Templates ───────────────────────────────────────────────

    private function seedSalaryTemplates(): void
    {
        $templates = [
            ['name' => 'Junior Engineer', 'desc' => 'For junior software engineers (0-2 years)'],
            ['name' => 'Senior Engineer', 'desc' => 'For senior software engineers (3-6 years)'],
            ['name' => 'Lead / Manager', 'desc' => 'For team leads and engineering managers'],
            ['name' => 'Intern', 'desc' => 'For interns and trainees'],
            ['name' => 'Executive', 'desc' => 'For non-technical executive roles'],
        ];

        $compCodes = ['BASIC', 'HRA', 'CONV', 'MED', 'SPL', 'PF_EE', 'PT'];

        foreach ($templates as $t) {
            $tpl = SalaryTemplate::updateOrCreate(
                ['organization_id' => $this->org->id, 'name' => $t['name']],
                ['description' => $t['desc'], 'currency' => 'INR', 'is_active' => true]
            );
        }
        $this->command->info('  ✓ Salary templates seeded');
    }

    // ─── Payroll Profiles ───────────────────────────────────────────────

    private function seedPayrollProfiles(): void
    {
        $banks = ['HDFC Bank', 'ICICI Bank', 'SBI', 'Axis Bank'];

        foreach ($this->employees as $emp) {
            $basic = $this->faker->randomElement([300000, 450000, 600000, 800000, 1000000, 1200000, 1500000]);
            PayrollProfile::updateOrCreate(
                ['organization_id' => $this->org->id, 'user_id' => $emp['id']],
                [
                    'currency' => 'INR',
                    'payout_method' => 'bank_transfer',
                    'bank_name' => $banks[array_rand($banks)],
                    'bank_account_number' => $this->faker->numerify('##############'),
                    'bank_ifsc_swift' => strtoupper($this->faker->bothify('####?####')),
                    'tax_identifier' => strtoupper($this->faker->bothify('#####')),
                    'payroll_eligible' => true,
                    'reimbursements_eligible' => true,
                    'earning_components' => json_encode([
                        ['code' => 'BASIC', 'type' => 'percentage', 'value' => 40],
                        ['code' => 'HRA', 'type' => 'percentage', 'value' => 20],
                        ['code' => 'SPL', 'type' => 'percentage', 'value' => 15],
                    ]),
                    'deduction_components' => json_encode([
                        ['code' => 'PF_EE', 'type' => 'percentage', 'value' => 12],
                        ['code' => 'PT', 'type' => 'fixed', 'value' => 200],
                    ]),
                ]
            );
        }
        $this->command->info('  ✓ Payroll profiles seeded');
    }

    // ─── Payslips ───────────────────────────────────────────────────────

    private function seedPayslips(): void
    {
        $months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
        $count = 0;

        foreach ($this->employees as $emp) {
            $annualCtc = $this->faker->randomElement([360000, 480000, 600000, 720000, 900000, 1200000, 1500000, 1800000]);
            $monthlyBasic = $annualCtc / 12 * 0.4;
            $monthlyHra = $monthlyBasic * 0.5;
            $monthlySpl = $monthlyBasic * 0.35;
            $monthlyGross = $monthlyBasic + $monthlyHra + $monthlySpl + 1600 + 1250;

            foreach ($months as $month) {
                $pf = min($monthlyBasic * 0.12, 21600);
                $esi = $monthlyGross <= 21000 ? $monthlyGross * 0.0075 : 0;
                $pt = 200;
                $tds = max(0, ($annualCtc - 250000) / 12 * 0.1);
                $deductions = $pf + $esi + $pt + $tds;
                $net = $monthlyGross - $deductions;

                $allowances = [
                    ['name' => 'Basic', 'amount' => round($monthlyBasic)],
                    ['name' => 'HRA', 'amount' => round($monthlyHra)],
                    ['name' => 'Special Allowance', 'amount' => round($monthlySpl)],
                    ['name' => 'Conveyance', 'amount' => 1600],
                    ['name' => 'Medical', 'amount' => 1250],
                ];
                $deductionItems = [
                    ['name' => 'PF', 'amount' => round($pf)],
                    ['name' => 'ESI', 'amount' => round($esi)],
                    ['name' => 'PT', 'amount' => $pt],
                    ['name' => 'TDS', 'amount' => round($tds)],
                ];

                Payslip::updateOrCreate(
                    ['organization_id' => $this->org->id, 'user_id' => $emp['id'], 'period_month' => $month],
                    [
                        'currency' => 'INR',
                        'basic_salary' => round($monthlyBasic),
                        'total_allowances' => round($monthlyHra + $monthlySpl + 2850),
                        'total_deductions' => round($deductions),
                        'net_salary' => round($net),
                        'allowances' => json_encode($allowances),
                        'deductions' => json_encode($deductionItems),
                        'generated_by' => $this->admin?->id,
                        'generated_at' => now()->subDays(rand(1, 30)),
                    ]
                );
                $count++;
            }
        }
        $this->command->info("  ✓ Payslips seeded ({$count} payslips)");
    }

    // ─── Payrolls ───────────────────────────────────────────────────────

    private function seedPayrolls(): void
    {
        $months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
        $statuses = ['draft', 'processed', 'paid'];
        $count = 0;

        foreach ($this->employees as $emp) {
            $annualCtc = $this->faker->randomElement([360000, 480000, 600000, 720000, 900000, 1200000]);
            $monthly = $annualCtc / 12;

            foreach ($months as $month) {
                $status = $statuses[array_rand($statuses)];
                Payroll::updateOrCreate(
                    ['organization_id' => $this->org->id, 'user_id' => $emp['id'], 'payroll_month' => $month],
                    [
                        'basic_salary' => round($monthly * 0.4),
                        'allowances' => round($monthly * 0.35),
                        'deductions' => round($monthly * 0.15),
                        'bonus' => $month === '2026-03' ? round($monthly * 0.0833) : 0,
                        'tax' => round($monthly * 0.1),
                        'net_salary' => round($monthly * 0.75),
                        'payroll_status' => $status,
                        'payout_status' => $status === 'paid' ? 'paid' : 'pending',
                        'generated_by' => $this->admin?->id,
                        'processed_at' => in_array($status, ['processed', 'paid']) ? now()->subDays(rand(1, 15)) : null,
                        'paid_at' => $status === 'paid' ? now()->subDays(rand(1, 10)) : null,
                    ]
                );
                $count++;
            }
        }
        $this->command->info("  ✓ Payrolls seeded ({$count} entries)");
    }

    // ─── Employee Loans ─────────────────────────────────────────────────

    private function seedEmployeeLoans(): void
    {
        $purposes = [
            'Medical emergency', 'Home renovation', 'Education fees',
            'Vehicle purchase', 'Wedding expenses', 'Family function',
            'Travel advance', 'Equipment purchase',
        ];
        $statuses = ['pending', 'approved', 'rejected', 'closed'];

        foreach ($this->employees as $emp) {
            $amount = $this->faker->randomElement([25000, 50000, 75000, 100000, 150000, 200000]);
            $emi = $this->faker->randomElement([5000, 8000, 10000, 12000, 15000]);
            $total = (int) ceil($amount / $emi);
            $paid = rand(0, $total);
            $status = $statuses[array_rand($statuses)];

            EmployeeLoan::updateOrCreate(
                ['user_id' => $emp['id'], 'organization_id' => $this->org->id],
                [
                    'loan_type' => $this->faker->randomElement(['advance', 'loan']),
                    'amount' => $amount,
                    'emi_amount' => $emi,
                    'total_installments' => $total,
                    'paid_installments' => $paid,
                    'remaining_amount' => max(0, $amount - ($paid * $emi)),
                    'purpose' => $purposes[array_rand($purposes)],
                    'status' => $status,
                    'approved_by' => in_array($status, ['approved', 'closed']) ? $this->admin?->id : null,
                    'approved_at' => in_array($status, ['approved', 'closed']) ? now()->subDays(rand(1, 30)) : null,
                    'disbursed_at' => $status === 'approved' ? now()->subDays(rand(1, 20)) : null,
                    'rejection_reason' => $status === 'rejected' ? 'Insufficient documentation' : null,
                ]
            );
        }
        $this->command->info('  ✓ Employee loans seeded (all employees)');
    }

    // ─── Leave Encashments ──────────────────────────────────────────────

    private function seedLeaveEncashments(): void
    {
        $leaveTypes = ['earned', 'casual', 'sick', 'compensatory'];
        $statuses = ['draft', 'approved', 'processed', 'rejected'];

        foreach ($this->employees as $emp) {
            if ($this->faker->boolean(50)) {
                $eligible = rand(5, 20);
                $encashed = rand(1, min($eligible, 10));
                $rate = round($this->faker->randomFloat(2, 800, 3000));
                $total = $encashed * $rate;
                $status = $statuses[array_rand($statuses)];

                LeaveEncashment::create([
                    'organization_id' => $this->org->id,
                    'user_id' => $emp['id'],
                    'leave_type' => $leaveTypes[array_rand($leaveTypes)],
                    'eligible_days' => $eligible,
                    'encashed_days' => $encashed,
                    'balance_days' => $eligible - $encashed,
                    'rate_per_day' => $rate,
                    'total_amount' => round($total),
                    'pf_deduction' => round($total * 0.12),
                    'tax_deduction' => round($total * 0.1),
                    'net_amount' => round($total * 0.78),
                    'status' => $status,
                    'month_year' => '2026-' . str_pad(rand(1, 6), 2, '0', STR_PAD_LEFT),
                    'requested_by' => $emp['id'],
                    'approved_by' => in_array($status, ['approved', 'processed']) ? $this->admin?->id : null,
                    'approved_at' => in_array($status, ['approved', 'processed']) ? now()->subDays(rand(1, 10)) : null,
                    'rejection_reason' => $status === 'rejected' ? 'Balance insufficient' : null,
                ]);
            }
        }
        $this->command->info('  ✓ Leave encashments seeded');
    }

    // ─── Arrear Payments ────────────────────────────────────────────────

    private function seedArrearPayments(): void
    {
        $arrearTypes = ['salary', 'increment', 'promotion', 'retrospective'];
        $statuses = ['draft', 'approved', 'processed', 'rejected'];

        foreach ($this->employees as $emp) {
            if ($this->faker->boolean(40)) {
                $origBasic = $this->faker->randomFloat(2, 20000, 80000);
                $revBasic = $origBasic * $this->faker->randomFloat(2, 1.05, 1.25);
                $diff = $revBasic - $origBasic;
                $status = $statuses[array_rand($statuses)];

                ArrearPayment::create([
                    'organization_id' => $this->org->id,
                    'user_id' => $emp['id'],
                    'arrear_month' => '2026-' . str_pad(rand(1, 5), 2, '0', STR_PAD_LEFT),
                    'calculation_month' => '2026-' . str_pad(rand(1, 6), 2, '0', STR_PAD_LEFT),
                    'arrear_type' => $arrearTypes[array_rand($arrearTypes)],
                    'original_basic' => round($origBasic),
                    'revised_basic' => round($revBasic),
                    'basic_difference' => round($diff),
                    'original_gross' => round($origBasic * 1.5),
                    'revised_gross' => round($revBasic * 1.5),
                    'gross_difference' => round($diff * 1.5),
                    'pf_on_arrear' => round($diff * 0.12),
                    'esi_on_arrear' => 0,
                    'tds_on_arrear' => round($diff * 0.1),
                    'pt_on_arrear' => 0,
                    'net_arrear_amount' => round($diff * 1.5 * 0.78),
                    'status' => $status,
                    'reason' => $this->faker->sentence(5),
                    'requested_by' => $emp['id'],
                    'approved_by' => in_array($status, ['approved', 'processed']) ? $this->admin?->id : null,
                    'approved_at' => in_array($status, ['approved', 'processed']) ? now()->subDays(rand(1, 10)) : null,
                    'rejection_reason' => $status === 'rejected' ? 'Awaiting revision approval' : null,
                ]);
            }
        }
        $this->command->info('  ✓ Arrear payments seeded');
    }

    // ─── F&F Settlements ────────────────────────────────────────────────

    private function seedFnFSettlements(): void
    {
        $exitTypes = ['resignation', 'termination', 'retirement', 'layoff'];
        $statuses = ['draft', 'pending', 'approved', 'rejected', 'processed', 'paid'];

        // Create 1-2 F&F settlements for variety (unique constraint on user_id)
        $count = 0;
        foreach (array_slice($this->employees, 0, 2) as $emp) {
            if (FullAndFinalSettlement::where('user_id', $emp['id'])->exists()) continue;
            $basic = $this->faker->randomFloat(2, 30000, 80000);
            $status = $statuses[array_rand($statuses)];
            $resignDate = $this->faker->dateTimeBetween('-60 days', '-10 days');
            $lastDay = (clone $resignDate)->modify('+30 days');
            $totalEarnings = $basic + rand(5000, 20000);
            $totalDeductions = rand(2000, 10000);

            FullAndFinalSettlement::create([
                'organization_id' => $this->org->id,
                'user_id' => $emp['id'],
                'resignation_date' => $resignDate->format('Y-m-d'),
                'last_working_date' => $lastDay->format('Y-m-d'),
                'settlement_date' => (clone $lastDay)->modify('+7 days')->format('Y-m-d'),
                'exit_type' => $exitTypes[array_rand($exitTypes)],
                'exit_reason' => $this->faker->sentence(5),
                'notice_period_days' => 30,
                'served_days' => rand(15, 30),
                'shortfall_days' => max(0, 30 - rand(15, 30)),
                'notice_pay_recovery' => rand(0, 5000),
                'basic_salary' => round($basic),
                'current_month_salary' => round($basic * 0.5),
                'salary_in_arrears' => rand(0, 10000),
                'earned_leave_balance' => rand(5, 15),
                'leave_encashment' => rand(5000, 20000),
                'comp_off_balance' => rand(0, 5),
                'comp_off_value' => rand(0, 5000),
                'years_of_service' => $this->faker->randomFloat(2, 0.5, 5),
                'gratuity_amount' => rand(0, 50000),
                'is_gratuity_eligible' => $this->faker->boolean(30),
                'loan_recovery' => rand(0, 15000),
                'advance_recovery' => rand(0, 5000),
                'asset_recovery' => rand(0, 3000),
                'other_deductions' => rand(0, 2000),
                'total_earnings' => round($totalEarnings),
                'total_deductions' => round($totalDeductions),
                'net_settlement_amount' => round($totalEarnings - $totalDeductions),
                'tds_on_settlement' => round(($totalEarnings - $totalDeductions) * 0.1),
                'status' => $status,
                'prepared_by' => $this->admin?->id,
                'approved_by' => in_array($status, ['approved', 'processed', 'paid']) ? $this->admin?->id : null,
                'approved_at' => in_array($status, ['approved', 'processed', 'paid']) ? now()->subDays(rand(1, 10)) : null,
                'notes' => $this->faker->sentence(8),
            ]);
            $count++;
        }
        $this->command->info("  ✓ F&F settlements seeded ({$count} entries)");
    }

    // ─── Resignations ───────────────────────────────────────────────────

    private function seedResignations(): void
    {
        $reasons = [
            'Better opportunity', 'Relocation', 'Higher education',
            'Personal reasons', 'Career change', 'Health issues',
        ];
        $statuses = ['pending', 'approved', 'rejected', 'cancelled'];

        foreach (array_slice($this->employees, 0, 2) as $emp) {
            $status = $statuses[array_rand($statuses)];
            $resignDate = $this->faker->dateTimeBetween('-60 days', '-10 days');

            Resignation::create([
                'user_id' => $emp['id'],
                'organization_id' => $this->org->id,
                'last_working_date' => (clone $resignDate)->modify('+30 days')->format('Y-m-d'),
                'reason' => $reasons[array_rand($reasons)],
                'status' => $status,
                'approved_by' => in_array($status, ['approved']) ? $this->admin?->id : null,
                'approved_at' => in_array($status, ['approved']) ? now()->subDays(rand(1, 10)) : null,
                'rejection_reason' => $status === 'rejected' ? 'Counter-offer made' : null,
                'rejected_at' => $status === 'rejected' ? now()->subDays(rand(1, 5)) : null,
                'cancelled_at' => $status === 'cancelled' ? now()->subDays(rand(1, 3)) : null,
            ]);
        }
        $this->command->info('  ✓ Resignations seeded');
    }

    // ─── Reimbursements ─────────────────────────────────────────────────

    private function seedReimbursements(): void
    {
        $titles = [
            'Internet bill reimbursement', 'Mobile phone recharge',
            'Office supplies', 'Travel expense', 'Team lunch',
            'Conference ticket', 'Training course', 'Books and resources',
            'Cab fare - late night', 'Client dinner',
        ];
        $statuses = ['draft', 'pending', 'manager_approved', 'admin_approved', 'paid', 'rejected'];

        foreach ($this->employees as $emp) {
            $reimbCount = rand(2, 5);
            for ($r = 0; $r < $reimbCount; $r++) {
                $status = $statuses[array_rand($statuses)];
                Reimbursement::create([
                    'organization_id' => $this->org->id,
                    'user_id' => $emp['id'],
                    'title' => $titles[array_rand($titles)],
                    'description' => $this->faker->sentence(5),
                    'expense_date' => $this->faker->dateTimeBetween('-30 days', 'now')->format('Y-m-d'),
                    'amount' => $this->faker->randomFloat(2, 200, 5000),
                    'currency' => 'INR',
                    'status' => $status,
                    'submitted_by' => $emp['id'],
                    'approved_by' => in_array($status, ['admin_approved', 'paid']) ? $this->admin?->id : null,
                    'approved_at' => in_array($status, ['admin_approved', 'paid']) ? now()->subDays(rand(1, 10)) : null,
                ]);
            }
        }
        $this->command->info('  ✓ Reimbursements seeded');
    }

    // ─── Assets ─────────────────────────────────────────────────────────

    private function seedAssets(): void
    {
        $assetData = [
            ['name' => 'MacBook Pro 14"', 'category' => 'Laptop', 'tag' => 'LAP'],
            ['name' => 'Dell Monitor 27"', 'category' => 'Monitor', 'tag' => 'MON'],
            ['name' => 'Logitech MX Keys', 'category' => 'Keyboard', 'tag' => 'KEY'],
            ['name' => 'Logitech MX Master 3S', 'category' => 'Mouse', 'tag' => 'MOU'],
            ['name' => 'AirPods Pro', 'category' => 'Headphones', 'tag' => 'HPH'],
            ['name' => 'iPhone 15', 'category' => 'Phone', 'tag' => 'PHN'],
            ['name' => 'iPad Air', 'category' => 'Tablet', 'tag' => 'TAB'],
            ['name' => 'Standing Desk', 'category' => 'Furniture', 'tag' => 'FRN'],
            ['name' => 'USB-C Hub', 'category' => 'Accessory', 'tag' => 'ACC'],
            ['name' => 'Webcam HD', 'category' => 'Camera', 'tag' => 'CAM'],
        ];

        foreach ($assetData as $i => $a) {
            $tag = $a['tag'] . '-' . str_pad($i + 1, 4, '0', STR_PAD_LEFT);
            $status = $this->faker->randomElement(['available', 'assigned']);

            $asset = Asset::updateOrCreate(
                ['organization_id' => $this->org->id, 'asset_tag' => $tag],
                [
                    'name' => $a['name'],
                    'category' => $a['category'],
                    'serial_number' => strtoupper(Str::random(12)),
                    'status' => $status,
                    'purchase_date' => $this->faker->dateTimeBetween('-2 years', '-3 months')->format('Y-m-d'),
                ]
            );

            if ($status === 'assigned') {
                AssetAssignment::updateOrCreate(
                    ['asset_id' => $asset->id, 'user_id' => $this->randomEmpId(), 'returned_date' => null],
                    [
                        'organization_id' => $this->org->id,
                        'assigned_by' => $this->admin?->id,
                        'assigned_date' => $this->faker->dateTimeBetween('-6 months', '-1 month')->format('Y-m-d'),
                    ]
                );
            }
        }
        $this->command->info('  ✓ Assets and assignments seeded');
    }

    // ─── Performance Goals ──────────────────────────────────────────────

    private function seedPerformanceGoals(): void
    {
        $goalTemplates = [
            ['title' => 'Complete Q2 project milestones', 'category' => 'project_delivery'],
            ['title' => 'Improve code review turnaround', 'category' => 'process_improvement'],
            ['title' => 'Mentor 2 junior developers', 'category' => 'leadership'],
            ['title' => 'Achieve 95% sprint velocity', 'category' => 'productivity'],
            ['title' => 'Reduce production bugs by 30%', 'category' => 'quality'],
            ['title' => 'Complete AWS certification', 'category' => 'learning'],
            ['title' => 'Lead cross-team initiative', 'category' => 'leadership'],
            ['title' => 'Improve test coverage to 80%', 'category' => 'quality'],
        ];

        foreach ($this->employees as $emp) {
            $goalCount = rand(2, 4);
            $usedGoals = [];
            for ($g = 0; $g < $goalCount; $g++) {
                $template = $goalTemplates[array_rand($goalTemplates)];
                if (in_array($template['title'], $usedGoals)) continue;
                $usedGoals[] = $template['title'];

                PerformanceGoal::create([
                    'organization_id' => $this->org->id,
                    'employee_id' => $emp['id'],
                    'manager_id' => $this->admin?->id,
                    'title' => $template['title'],
                    'description' => $this->faker->paragraph(1),
                    'category' => $template['category'],
                    'start_date' => $this->faker->dateTimeBetween('-3 months', '-1 month')->format('Y-m-d'),
                    'end_date' => $this->faker->dateTimeBetween('+1 month', '+3 months')->format('Y-m-d'),
                    'target_metrics' => json_encode(['target' => $this->faker->numberBetween(70, 100), 'unit' => 'percentage']),
                    'weight' => $this->faker->randomElement([25, 50, 75, 100]),
                    'progress_percentage' => $this->faker->numberBetween(10, 90),
                    'status' => $this->faker->randomElement(['active', 'completed', 'on_track', 'at_risk']),
                ]);
            }
        }
        $this->command->info('  ✓ Performance goals seeded');
    }

    // ─── Performance Reviews ────────────────────────────────────────────

    private function seedPerformanceReviews(): void
    {
        $reviewTypes = ['self', 'manager', 'peer', '360'];
        $statuses = ['draft', 'in_progress', 'completed'];

        foreach ($this->employees as $emp) {
            if ($this->faker->boolean(70)) {
                $periodStart = $this->faker->dateTimeBetween('-6 months', '-3 months');
                $periodEnd = (clone $periodStart)->modify('+3 months');

                PerformanceReview::create([
                    'organization_id' => $this->org->id,
                    'employee_id' => $emp['id'],
                    'reviewer_id' => $this->admin?->id,
                    'review_type' => $reviewTypes[array_rand($reviewTypes)],
                    'review_period_start' => $periodStart->format('Y-m-d'),
                    'review_period_end' => $periodEnd->format('Y-m-d'),
                    'overall_rating' => rand(1, 5),
                    'strengths' => json_encode([$this->faker->sentence(5), $this->faker->sentence(4)]),
                    'areas_for_improvement' => json_encode([$this->faker->sentence(5), $this->faker->sentence(4)]),
                    'goals' => json_encode([$this->faker->sentence(6), $this->faker->sentence(5)]),
                    'comments' => $this->faker->paragraph(1),
                    'is_confidential' => $this->faker->boolean(20),
                    'status' => $statuses[array_rand($statuses)],
                ]);
            }
        }
        $this->command->info('  ✓ Performance reviews seeded');
    }

    // ─── Tax Declarations ───────────────────────────────────────────────

    private function seedTaxDeclarations(): void
    {
        $statuses = ['draft', 'submitted', 'approved'];

        foreach ($this->employees as $emp) {
            $total = $this->faker->randomFloat(2, 50000, 300000);
            $status = $statuses[array_rand($statuses)];

            EmployeeTaxDeclaration::updateOrCreate(
                ['user_id' => $emp['id'], 'financial_year' => '2025-26'],
                [
                    'organization_id' => $this->org->id,
                    'status' => $status,
                    'total_declared_amount' => round($total),
                    'approved_amount' => $status === 'approved' ? round($total * $this->faker->randomFloat(2, 0.8, 1.0)) : 0,
                    'submitted_at' => in_array($status, ['submitted', 'approved']) ? now()->subDays(rand(1, 30)) : null,
                    'approved_by' => $status === 'approved' ? $this->admin?->id : null,
                    'approved_at' => $status === 'approved' ? now()->subDays(rand(1, 10)) : null,
                    'remarks' => $status === 'approved' ? 'All proofs verified' : null,
                ]
            );
        }
        $this->command->info('  ✓ Tax declarations seeded');
    }

    // ─── FBP Components ─────────────────────────────────────────────────

    private function seedFbpComponents(): void
    {
        $components = [
            ['name' => 'Food & Beverage', 'code' => 'FBP_FOOD', 'category' => 'food', 'max' => 50000, 'taxable' => false],
            ['name' => 'Transport', 'code' => 'FBP_TRANSPORT', 'category' => 'transport', 'max' => 30000, 'taxable' => false],
            ['name' => 'Communication', 'code' => 'FBP_COMM', 'category' => 'communication', 'max' => 12000, 'taxable' => false],
            ['name' => 'Books & Periodicals', 'code' => 'FBP_BOOKS', 'category' => 'education', 'max' => 10000, 'taxable' => false],
            ['name' => 'Gadget Allowance', 'code' => 'FBP_GADGET', 'category' => 'gadget', 'max' => 25000, 'taxable' => true],
            ['name' => 'Wellness', 'code' => 'FBP_WELLNESS', 'category' => 'wellness', 'max' => 15000, 'taxable' => false],
        ];

        foreach ($components as $c) {
            FbpComponent::updateOrCreate(
                ['organization_id' => $this->org->id, 'code' => $c['code']],
                [
                    'name' => $c['name'],
                    'category' => $c['category'],
                    'max_exempt_limit' => $c['max'],
                    'requires_proof' => true,
                    'is_taxable' => $c['taxable'],
                    'description' => "{$c['name']} allowance under FBP",
                    'is_active' => true,
                ]
            );
        }
        $this->command->info('  ✓ FBP components seeded');
    }

    // ─── FBP Allocations ────────────────────────────────────────────────

    private function seedFbpAllocations(): void
    {
        $components = FbpComponent::where('organization_id', $this->org->id)->get();
        foreach ($this->employees as $emp) {
            $compCount = rand(2, 4);
            $usedComps = [];
            for ($c = 0; $c < $compCount; $c++) {
                $comp = $components->random();
                if (in_array($comp->id, $usedComps)) continue;
                $usedComps[] = $comp->id;

                $allocated = $comp->max_exempt_limit * $this->faker->randomFloat(2, 0.3, 1.0);
                FbpAllocation::updateOrCreate(
                    ['user_id' => $emp['id'], 'fbp_component_id' => $comp->id, 'financial_year' => '2025-26'],
                    [
                        'organization_id' => $this->org->id,
                        'allocated_amount' => round($allocated),
                        'utilized_amount' => round($allocated * $this->faker->randomFloat(2, 0.1, 0.9)),
                        'claimed_amount' => round($allocated * $this->faker->randomFloat(2, 0.0, 0.6)),
                        'status' => 'active',
                    ]
                );
            }
        }
        $this->command->info('  ✓ FBP allocations seeded');
    }

    // ─── FBP Claims ─────────────────────────────────────────────────────

    private function seedFbpClaims(): void
    {
        $statuses = ['pending', 'approved', 'rejected'];
        $allocations = FbpAllocation::where('organization_id', $this->org->id)->get();

        foreach ($allocations->random(min(20, $allocations->count())) as $alloc) {
            $status = $statuses[array_rand($statuses)];
            $amount = $this->faker->randomFloat(2, 500, min(5000, $alloc->allocated_amount));

            FbpClaim::create([
                'organization_id' => $this->org->id,
                'user_id' => $alloc->user_id,
                'fbp_allocation_id' => $alloc->id,
                'fbp_component_id' => $alloc->fbp_component_id,
                'claimed_amount' => round($amount),
                'approved_amount' => $status === 'approved' ? round($amount) : null,
                'bill_number' => strtoupper(Str::random(8)),
                'bill_date' => $this->faker->dateTimeBetween('-30 days', 'now')->format('Y-m-d'),
                'description' => $this->faker->sentence(4),
                'status' => $status,
                'approved_by' => $status === 'approved' ? $this->admin?->id : null,
                'approved_at' => $status === 'approved' ? now()->subDays(rand(1, 5)) : null,
                'rejection_reason' => $status === 'rejected' ? 'Invalid bill format' : null,
                'month_year' => '2026-' . str_pad(rand(1, 6), 2, '0', STR_PAD_LEFT),
                'is_tax_exempt' => true,
            ]);
        }
        $this->command->info('  ✓ FBP claims seeded');
    }

    // ─── Perquisites ────────────────────────────────────────────────────

    private function seedPerquisites(): void
    {
        if (!\Schema::hasTable('employee_perquisites')) {
            $this->command->info('  ✓ Perquisites skipped (table not migrated)');
            return;
        }

        $types = [
            ['type' => 'Company Car', 'desc' => 'Official vehicle for commute', 'monthly' => 8000],
            ['type' => 'Laptop', 'desc' => 'Company laptop for work', 'monthly' => 2500],
            ['type' => 'Phone', 'desc' => 'Company mobile phone', 'monthly' => 1500],
            ['type' => 'Club Membership', 'desc' => 'Corporate club membership', 'monthly' => 3000],
            ['type' => 'Accommodation', 'desc' => 'Company-provided housing', 'monthly' => 15000],
        ];

        foreach ($this->employees as $emp) {
            if ($this->faker->boolean(30)) {
                $perq = $types[array_rand($types)];
                EmployeePerquisite::create([
                    'organization_id' => $this->org->id,
                    'user_id' => $emp['id'],
                    'type' => $perq['type'],
                    'description' => $perq['desc'],
                    'monthly_value' => $perq['monthly'],
                    'annual_value' => $perq['monthly'] * 12,
                    'taxable_value' => $perq['monthly'] * 12 * 0.8,
                    'employee_contribution' => $perq['monthly'] * 12 * 0.2,
                    'from_date' => $this->faker->dateTimeBetween('-1 year', '-6 months')->format('Y-m-d'),
                    'to_date' => $this->faker->dateTimeBetween('+6 months', '+1 year')->format('Y-m-d'),
                    'is_active' => true,
                ]);
            }
        }
        $this->command->info('  ✓ Perquisites seeded');
    }

    // ─── Chat ───────────────────────────────────────────────────────────

    private function seedChat(): void
    {
        $userIds = $this->userIds();
        $conversations = [];

        // Create conversations between pairs of employees
        $pairs = [];
        for ($i = 0; $i < count($userIds); $i++) {
            for ($j = $i + 1; $j < min($i + 3, count($userIds)); $j++) {
                $pairs[] = [$userIds[$i], $userIds[$j]];
            }
        }

        foreach (array_slice($pairs, 0, 10) as $pair) {
            // Normalize participant order so (353,344) and (344,353) don't collide
            $p1 = min($pair[0], $pair[1]);
            $p2 = max($pair[0], $pair[1]);

            $conv = ChatConversation::firstOrCreate(
                ['organization_id' => $this->org->id, 'participant_one_id' => $p1, 'participant_two_id' => $p2],
                []
            );
            $conversations[] = $conv->id;

            // Messages only if no messages exist yet
            if ($conv->messages()->count() === 0) {
                $msgCount = rand(3, 10);
                for ($m = 0; $m < $msgCount; $m++) {
                    ChatMessage::create([
                        'conversation_id' => $conv->id,
                        'sender_id' => $pair[array_rand([0, 1]) === 0 ? 0 : 1] ? $pair[array_rand([0, 1])] : $pair[0],
                        'body' => $this->faker->sentence(rand(3, 12)),
                        'read_at' => $m < $msgCount - 1 ? now()->subMinutes(rand(1, 60)) : null,
                    ]);
                }
            }
        }
        $convCount = count($conversations);
        $this->command->info("  ✓ Chat seeded ({$convCount} conversations with messages)");
    }

    // ─── Notifications ──────────────────────────────────────────────────

    private function seedNotifications(): void
    {
        $types = ['announcement', 'reminder', 'update', 'alert', 'mention'];
        $titles = [
            'Company Town Hall Meeting', 'Holiday Reminder',
            'New Policy Update', 'Performance Review Deadline',
            'Salary Credit Notification', 'Leave Balance Update',
            'Project Milestone Achieved', 'Team Outing Announcement',
            'System Maintenance Window', 'Training Session Schedule',
        ];
        $count = 0;
        foreach ($this->allUsers() as $user) {
            $notifCount = rand(3, 8);
            for ($n = 0; $n < $notifCount; $n++) {
                $isRead = $this->faker->boolean(60);
                AppNotification::create([
                    'organization_id' => $this->org->id,
                    'user_id' => $user['id'],
                    'sender_id' => $this->admin?->id,
                    'type' => $types[array_rand($types)],
                    'title' => $titles[array_rand($titles)],
                    'message' => $this->faker->paragraph(1),
                    'is_read' => $isRead,
                    'read_at' => $isRead ? now()->subDays(rand(1, 10)) : null,
                ]);
                $count++;
            }
        }
        $this->command->info("  ✓ Notifications seeded ({$count} entries)");
    }

    // ─── Audit Logs ─────────────────────────────────────────────────────

    private function seedAuditLogs(): void
    {
        $actions = [
            'user.login', 'user.logout', 'user.created', 'user.updated',
            'payroll.processed', 'payroll.approved', 'leave.approved',
            'settings.updated', 'project.created', 'task.created',
            'invoice.created', 'document.uploaded', 'asset.assigned',
        ];
        $count = 0;
        foreach ($this->allUsers() as $user) {
            for ($a = 0; $a < rand(5, 15); $a++) {
                DB::table('audit_logs')->insert([
                    'organization_id' => $this->org->id,
                    'actor_user_id' => $user['id'],
                    'action' => $actions[array_rand($actions)],
                    'target_type' => $this->faker->randomElement(['user', 'project', 'task', 'invoice', 'payroll']),
                    'target_id' => $user['id'],
                    'metadata' => json_encode(['ip' => $this->faker->ipv4]),
                    'ip_address' => $this->faker->ipv4,
                    'user_agent' => $this->faker->userAgent,
                    'created_at' => $this->faker->dateTimeBetween('-30 days', 'now'),
                    'updated_at' => now(),
                ]);
                $count++;
            }
        }
        $this->command->info("  ✓ Audit logs seeded ({$count} entries)");
    }
}
