<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('attendance_selfies', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->date('attendance_date');
            $table->string('image_path', 500);
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();
            $table->unsignedSmallInteger('accuracy_meters')->nullable();
            $table->timestamps();

            $table->unique(['user_id', 'attendance_date'], 'attendance_selfies_user_date_unique');
            $table->index('attendance_date', 'attendance_selfies_date_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('attendance_selfies');
    }
};
