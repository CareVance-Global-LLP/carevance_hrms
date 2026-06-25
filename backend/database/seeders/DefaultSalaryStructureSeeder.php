<?php

namespace Database\Seeders;

use App\Models\Organization;
use App\Models\SalaryTemplate;
use Illuminate\Database\Seeder;

class DefaultSalaryStructureSeeder extends Seeder
{
    public function run(): void
    {
        $organizations = Organization::all();

        foreach ($organizations as $org) {
            $existingDefault = SalaryTemplate::where('organization_id', $org->id)
                ->where('is_default', true)
                ->first();

            if ($existingDefault) {
                continue;
            }

            SalaryTemplate::create([
                'organization_id' => $org->id,
                'name' => 'Standard',
                'description' => 'Default salary structure: Basic 50%, HRA 50% of Basic, Conveyance ₹1,600',
                'basic_percentage' => 50,
                'hra_percentage' => 50,
                'conveyance_amount' => 1600,
                'da_percentage' => 0,
                'cca_amount' => 0,
                'education_allowance' => 0,
                'internet_allowance' => 0,
                'meal_allowance' => 0,
                'transport_allowance' => 0,
                'uniform_allowance' => 0,
                'books_periodicals' => 0,
                'fuel_maintenance' => 0,
                'nps_percentage' => 0,
                'vpf_percentage' => 0,
                'other_earnings' => null,
                'is_default' => true,
                'is_active' => true,
                'currency' => 'INR',
            ]);
        }
    }
}
