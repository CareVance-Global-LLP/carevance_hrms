<?php

namespace Database\Factories;

use App\Models\EmployeeWorkInfo;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<EmployeeWorkInfo>
 */
class EmployeeWorkInfoFactory extends Factory
{
    protected $model = EmployeeWorkInfo::class;

    public function definition(): array
    {
        return [
            'organization_id' => Organization::factory(),
            'user_id' => User::factory(),
            'employee_code' => 'EMP-' . Str::upper(Str::random(6)),
            'designation' => $this->faker->jobTitle(),
            'work_location' => $this->faker->city(),
            'employment_type' => 'full_time',
            'joining_date' => $this->faker->dateTimeBetween('-5 years', '-1 month')->format('Y-m-d'),
            'probation_status' => 'confirmed',
            'employment_status' => 'active',
            'work_mode' => 'onsite',
            'expected_start_time' => '09:30',
            'expected_timezone' => 'Asia/Kolkata',
        ];
    }
}
