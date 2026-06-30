<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('salary_revision_letters')) {
            Schema::create('salary_revision_letters', function (Blueprint $table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->decimal('old_ctc', 14, 2)->default(0);
                $table->decimal('new_ctc', 14, 2)->default(0);
                $table->decimal('revision_percentage', 5, 2)->default(0);
                $table->string('revision_type')->default('annual'); // annual, promotion, adhoc, correction
                $table->date('effective_from')->nullable();
                $table->text('reason')->nullable();
                $table->json('old_breakdown')->nullable();
                $table->json('new_breakdown')->nullable();
                $table->string('letter_file_path')->nullable();
                $table->string('status')->default('generated'); // generated, accepted, rejected
                $table->timestamp('accepted_at')->nullable();
                $table->timestamp('rejected_at')->nullable();
                $table->foreignId('generated_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamps();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('salary_revision_letters');
    }
};
