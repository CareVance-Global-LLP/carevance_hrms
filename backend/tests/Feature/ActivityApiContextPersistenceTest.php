<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ActivityApiContextPersistenceTest extends TestCase
{
    use RefreshDatabase;

    public function test_employee_activity_create_persists_raw_browser_context(): void
    {
        $organization = Organization::create(['name' => 'CareVance Labs', 'slug' => 'carevance-labs']);
        $user = User::create([
            'name' => 'Employee User',
            'email' => 'employee@example.com',
            'password' => 'password123',
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $response = $this->postJson('/api/activities', [
            'type' => 'url',
            'name' => 'github.com',
            'duration' => 1,
            'recorded_at' => '2026-04-20T10:00:00Z',
            'app_name' => 'Google Chrome',
            'window_title' => 'OpenAI/Codex - Pull requests - Google Chrome',
            'url' => 'https://github.com/openai/codex/pulls',
        ], $this->apiHeadersFor($user));

        $response->assertCreated()
            ->assertJsonPath('type', 'url')
            ->assertJsonPath('name', 'github.com')
            ->assertJsonPath('app_name', 'Google Chrome')
            ->assertJsonPath('window_title', 'OpenAI/Codex - Pull requests - Google Chrome')
            ->assertJsonPath('url', 'https://github.com/openai/codex/pulls')
            ->assertJsonPath('normalized_domain', 'github.com')
            ->assertJsonPath('tool_type', 'website');

        $this->assertDatabaseHas('activities', [
            'user_id' => $user->id,
            'type' => 'url',
            'name' => 'github.com',
            'app_name' => 'Google Chrome',
            'window_title' => 'OpenAI/Codex - Pull requests - Google Chrome',
            'url' => 'https://github.com/openai/codex/pulls',
            'normalized_domain' => 'github.com',
        ]);
    }
}
