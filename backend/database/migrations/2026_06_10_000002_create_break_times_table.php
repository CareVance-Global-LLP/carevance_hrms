<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('break_times', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->onDelete('cascade');
            $table->foreignId('user_id')->constrained()->onDelete('cascade');
            $table->date('break_date');
            $table->dateTime('start_at');
            $table->dateTime('end_at')->nullable();
            $table->integer('duration_seconds')->default(0);
            $table->string('reason')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'break_date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('break_times');
    }
};
