<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pay_group_filing_details', function (Blueprint $table) {
            $table->id();
            $table->foreignId('pay_group_id')->constrained()->cascadeOnDelete();
            $table->string('state_code', 10);
            $table->string('state_name', 50);

            $table->boolean('pt_enabled')->default(true);
            $table->string('pt_establishment_id', 100)->nullable();
            $table->date('pt_registration_date')->nullable();
            $table->string('pt_signatory', 100)->nullable();

            $table->boolean('lwf_enabled')->default(false);
            $table->string('lwf_establishment_id', 100)->nullable();
            $table->date('lwf_registration_date')->nullable();
            $table->string('lwf_signatory', 100)->nullable();

            $table->string('pf_registration_number', 100)->nullable();
            $table->string('pf_group_code', 50)->nullable();

            $table->string('esi_registration_number', 100)->nullable();

            $table->timestamps();

            $table->unique(['pay_group_id', 'state_code']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pay_group_filing_details');
    }
};
