<?php

namespace Database\Factories;

use App\Models\EmployeeProfile;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<EmployeeProfile>
 */
class EmployeeProfileFactory extends Factory
{
    protected $model = EmployeeProfile::class;

    public function definition(): array
    {
        $firstName = $this->faker->firstName();
        $lastName = $this->faker->lastName();

        return [
            'organization_id' => Organization::factory(),
            'user_id' => User::factory(),
            'first_name' => $firstName,
            'last_name' => $lastName,
            'display_name' => "{$firstName} {$lastName}",
            'gender' => $this->faker->randomElement(['male', 'female', 'other']),
            'date_of_birth' => $this->faker->dateTimeBetween('-55 years', '-21 years')->format('Y-m-d'),
            'phone' => $this->faker->numerify('9#########'),
            'personal_email' => $this->faker->unique()->safeEmail(),
            'address_line' => $this->faker->streetAddress(),
            'city' => $this->faker->city(),
            'state' => 'Maharashtra',
            'postal_code' => $this->faker->numerify('4#####'),
            'emergency_contact_name' => $this->faker->name(),
            'emergency_contact_number' => $this->faker->numerify('9#########'),
            'emergency_contact_relationship' => 'spouse',
        ];
    }
}
