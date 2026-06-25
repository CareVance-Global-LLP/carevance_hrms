<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('salary_templates', function (Blueprint $table) {
            $table->decimal('basic_percentage', 5, 2)->default(50)->after('description');
            $table->decimal('hra_percentage', 5, 2)->default(50)->after('basic_percentage');
            $table->decimal('conveyance_amount', 10, 2)->default(1600)->after('hra_percentage');
            $table->decimal('da_percentage', 5, 2)->default(0)->after('conveyance_amount');
            $table->decimal('cca_amount', 10, 2)->default(0)->after('da_percentage');
            $table->decimal('education_allowance', 10, 2)->default(0)->after('cca_amount');
            $table->decimal('internet_allowance', 10, 2)->default(0)->after('education_allowance');
            $table->decimal('meal_allowance', 10, 2)->default(0)->after('internet_allowance');
            $table->decimal('transport_allowance', 10, 2)->default(0)->after('meal_allowance');
            $table->decimal('uniform_allowance', 10, 2)->default(0)->after('transport_allowance');
            $table->decimal('books_periodicals', 10, 2)->default(0)->after('uniform_allowance');
            $table->decimal('fuel_maintenance', 10, 2)->default(0)->after('books_periodicals');
            $table->decimal('nps_percentage', 5, 2)->default(0)->after('fuel_maintenance');
            $table->decimal('vpf_percentage', 5, 2)->default(0)->after('nps_percentage');
            $table->json('other_earnings')->nullable()->after('vpf_percentage');
            $table->boolean('is_default')->default(false)->after('is_active');
        });
    }

    public function down(): void
    {
        Schema::table('salary_templates', function (Blueprint $table) {
            $table->dropColumn([
                'basic_percentage',
                'hra_percentage',
                'conveyance_amount',
                'da_percentage',
                'cca_amount',
                'education_allowance',
                'internet_allowance',
                'meal_allowance',
                'transport_allowance',
                'uniform_allowance',
                'books_periodicals',
                'fuel_maintenance',
                'nps_percentage',
                'vpf_percentage',
                'other_earnings',
                'is_default',
            ]);
        });
    }
};
