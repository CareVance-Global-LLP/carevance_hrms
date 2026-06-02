<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('plans', function (Blueprint $table) {
            $table->id();
            $table->string('code')->unique(); // e.g., 'basic', 'professional', 'enterprise'
            $table->string('name'); // e.g., 'Basic', 'Professional', 'Enterprise'
            $table->text('description')->nullable();
            $table->decimal('price_monthly', 10, 2)->default(0);
            $table->decimal('price_yearly', 10, 2)->nullable();
            $table->integer('max_employees')->default(25);
            $table->json('features')->nullable(); // Array of feature keys
            $table->boolean('is_active')->default(true);
            $table->boolean('is_popular')->default(false);
            $table->integer('display_order')->default(0);
            $table->timestamps();
        });
        
        // Insert default plans
        $this->seedDefaultPlans();
    }
    
    /**
     * Seed default plans
     */
    private function seedDefaultPlans(): void
    {
        $plans = [
            [
                'code' => 'basic',
                'name' => 'Basic',
                'description' => 'Core monitoring, attendance, and reporting for growing teams.',
                'price_monthly' => 999,
                'price_yearly' => 9990, // 2 months free
                'max_employees' => 25,
                'features' => json_encode([
                    'attendance',
                    'leave_management',
                    'basic_reports',
                ]),
                'is_active' => true,
                'is_popular' => false,
                'display_order' => 1,
            ],
            [
                'code' => 'professional',
                'name' => 'Professional',
                'description' => 'Advanced monitoring, communication, and project management for scaling teams.',
                'price_monthly' => 2499,
                'price_yearly' => 24990, // 2 months free
                'max_employees' => 100,
                'features' => json_encode([
                    'attendance',
                    'leave_management',
                    'basic_reports',
                    'payroll',
                    'advanced_reports',
                    'project_tracking',
                    'screenshots',
                    'productivity_tracking',
                    'browser_tracking',
                    'chat',
                ]),
                'is_active' => true,
                'is_popular' => true,
                'display_order' => 2,
            ],
            [
                'code' => 'enterprise',
                'name' => 'Enterprise',
                'description' => 'For larger organizations that want custom rollout planning, controls, and guided onboarding.',
                'price_monthly' => 4999,
                'price_yearly' => 49990, // 2 months free
                'max_employees' => -1, // Unlimited
                'features' => json_encode([
                    'attendance',
                    'leave_management',
                    'basic_reports',
                    'payroll',
                    'advanced_reports',
                    'project_tracking',
                    'screenshots',
                    'productivity_tracking',
                    'browser_tracking',
                    'chat',
                    'api_access',
                    'priority_support',
                    'custom_integrations',
                ]),
                'is_active' => true,
                'is_popular' => false,
                'display_order' => 3,
            ],
        ];
        
        foreach ($plans as $plan) {
            DB::table('plans')->insert(array_merge($plan, [
                'created_at' => now(),
                'updated_at' => now(),
            ]));
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('plans');
    }
};
