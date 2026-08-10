<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The missing half of compensatory-off.
 *
 * `comp_off_transactions` was created long ago, but `comp_off_balance` — the
 * running balance every one of those transactions points at, and the table the
 * CompOffBalance model declares — never was. The result was that the models,
 * controller and routes all shipped while every comp-off endpoint answered
 * "relation comp_off_balance does not exist".
 *
 * Columns follow CompOffBalance's $fillable and $casts exactly. The singular
 * table name is what the model declares; renaming it would be a wider change
 * than restoring the feature.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('comp_off_balance')) {
            return;
        }

        Schema::create('comp_off_balance', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();

            $table->integer('earned_days')->default(0);
            $table->integer('used_days')->default(0);
            $table->integer('expired_days')->default(0);
            $table->integer('balance_days')->default(0);

            // Comp-off is granted against, and expires with, a leave year.
            $table->string('applicable_year', 9)->nullable();
            $table->date('expiry_date')->nullable();

            $table->json('transaction_history')->nullable();
            $table->timestamps();

            // One running balance per person per leave year.
            $table->unique(['user_id', 'applicable_year']);
            $table->index(['organization_id', 'applicable_year']);
            $table->index('expiry_date');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('comp_off_balance');
    }
};
