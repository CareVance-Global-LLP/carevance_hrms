<?php

namespace Database\Factories;

use App\Models\EmployeeBankAccount;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<EmployeeBankAccount>
 */
class EmployeeBankAccountFactory extends Factory
{
    protected $model = EmployeeBankAccount::class;

    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'user_id' => User::factory(),
            'account_holder_name' => $this->faker->name(),
            'bank_name' => $this->faker->randomElement([
                'HDFC Bank', 'ICICI Bank', 'State Bank of India', 'Axis Bank', 'Kotak Mahindra Bank',
            ]),
            'account_number' => $this->faker->numerify('##############'),
            'ifsc_swift' => Str::upper(Str::random(4)) . '0' . $this->faker->numerify('######'),
            'branch' => $this->faker->city(),
            'account_type' => 'savings',
            'payout_method' => 'bank_transfer',
            'is_default' => true,
            'verification_status' => 'verified',
        ];
    }
}
