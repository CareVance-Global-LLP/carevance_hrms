<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pay_groups', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('code')->unique();
            $table->text('description')->nullable();
            $table->string('pay_frequency')->default('monthly'); // monthly, weekly, biweekly, daily
            $table->tinyInteger('pay_day')->nullable();
            $table->string('pay_day_type')->default('specific'); // specific, last_working_day, last_day
            $table->json('statutory_rules')->nullable();
            $table->foreignId('salary_template_id')->nullable()->constrained('salary_templates')->nullOnDelete();
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['organization_id', 'is_active']);
        });

        Schema::create('pay_group_assignments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('pay_group_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->date('effective_from');
            $table->date('effective_to')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['pay_group_id', 'user_id', 'is_active']);
            $table->index(['organization_id', 'is_active']);
            $table->unique(['user_id', 'effective_from']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pay_group_assignments');
        Schema::dropIfExists('pay_groups');
    }
};
