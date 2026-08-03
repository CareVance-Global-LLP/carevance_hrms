<?php

namespace Database\Factories;

use App\Models\Group;
use App\Models\Organization;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Group>
 */
class GroupFactory extends Factory
{
    protected $model = Group::class;

    public function definition(): array
    {
        $name = $this->faker->unique()->words(2, true);

        return [
            'organization_id' => Organization::factory(),
            'name' => Str::title($name),
            'slug' => Str::slug($name) . '-' . Str::lower(Str::random(6)),
            'description' => $this->faker->sentence(),
            'is_active' => true,
        ];
    }
}
