<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('department_teams', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->foreignId('department_id')->constrained('groups')->cascadeOnDelete();
            $table->string('name');
            $table->string('slug')->nullable();
            $table->text('description')->nullable();
            $table->timestamps();

            $table->unique(['organization_id', 'department_id', 'slug'], 'dept_teams_org_dept_slug_unique');
            $table->index(['organization_id', 'department_id'], 'dept_teams_org_dept_idx');
        });

        Schema::create('department_team_members', function (Blueprint $table) {
            $table->id();
            $table->foreignId('team_id')->constrained('department_teams')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['team_id', 'user_id'], 'dept_team_members_unique');
            $table->index(['team_id', 'user_id'], 'dept_team_members_idx');
        });

        Schema::create('department_team_managers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('team_id')->constrained('department_teams')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['team_id', 'user_id'], 'dept_team_managers_unique');
            $table->index(['team_id', 'user_id'], 'dept_team_managers_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('department_team_managers');
        Schema::dropIfExists('department_team_members');
        Schema::dropIfExists('department_teams');
    }
};
