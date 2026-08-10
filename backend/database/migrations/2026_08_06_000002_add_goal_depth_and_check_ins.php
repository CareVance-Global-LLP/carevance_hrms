<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('goal_check_ins', function (Blueprint $table) {
            $table->id();
            $table->foreignId('goal_id')->constrained('performance_goals')->onDelete('cascade');
            $table->foreignId('user_id')->constrained('users')->onDelete('cascade');
            $table->unsignedTinyInteger('progress_percentage');
            $table->text('note')->nullable();
            $table->timestamps();

            $table->index(['goal_id', 'created_at']);
        });

        Schema::table('performance_goals', function (Blueprint $table) {
            $table->string('scope')->default('individual')->after('manager_id'); // individual, team, company
            $table->foreignId('parent_goal_id')->nullable()->after('scope')
                ->constrained('performance_goals')->onDelete('set null');
            $table->foreignId('group_id')->nullable()->after('parent_goal_id')
                ->constrained('groups')->onDelete('set null');
            // Team/company goals belong to a department or the org, not a person
            $table->foreignId('employee_id')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('performance_goals', function (Blueprint $table) {
            $table->dropConstrainedForeignId('parent_goal_id');
            $table->dropConstrainedForeignId('group_id');
            $table->dropColumn('scope');
            $table->foreignId('employee_id')->nullable(false)->change();
        });
        Schema::dropIfExists('goal_check_ins');
    }
};
