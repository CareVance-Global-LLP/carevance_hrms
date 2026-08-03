<?php

namespace Database\Factories;

use App\Models\Organization;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Organization>
 */
class OrganizationFactory extends Factory
{
    protected $model = Organization::class;

    public function definition(): array
    {
        $name = $this->faker->unique()->company();

        return [
            'name' => $name,
            // `slug` is unique and NOT NULL; suffix guards against collisions
            // when faker repeats a company name across a large test run.
            'slug' => Str::slug($name) . '-' . Str::lower(Str::random(6)),
            'subscription_status' => 'active',
        ];
    }

    public function trial(): static
    {
        return $this->state(fn () => [
            'subscription_status' => 'trial',
            'subscription_expires_at' => now()->addDays(14)->toDateString(),
        ]);
    }

    public function expired(): static
    {
        return $this->state(fn () => [
            'subscription_status' => 'expired',
            'subscription_expires_at' => now()->subDay()->toDateString(),
        ]);
    }
}
