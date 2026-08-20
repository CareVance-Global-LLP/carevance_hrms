<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The in-app AI assistant is an administrative surface.
 *
 * Its tools read organisation-wide attendance, payroll and headcount. The
 * endpoint lives in routes/api/public.php because the *landing page* sales bot
 * genuinely serves unauthenticated visitors, and for a long time that was the
 * only thing guarding it: `api.token.optional` resolves a user when a token is
 * present and waves the request through when it is not. Any employee — and any
 * stranger — could POST to it.
 *
 * The gate is `getHierarchyLevel() <= 10`, which is super_admin (0) and admin
 * (10), and which respects custom roles through their own hierarchy_level. It
 * mirrors hasStrictAdminAccess() in frontend/src/lib/permissions.ts.
 */
class AiChatAccessTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        /*
         * No provider key, so AiChatService short-circuits to its "not
         * configured" reply before any outbound HTTP. These tests assert on the
         * authorisation decision, which happens in the controller, and must not
         * depend on a live AI provider.
         */
        config([
            'services.ai.api_key' => '',
            'services.ai.secondary_api_key' => '',
        ]);
    }

    private function organization(): Organization
    {
        return Organization::create(['name' => 'Org', 'slug' => 'org']);
    }

    private function userWithRole(string $role, Organization $organization): User
    {
        return User::create([
            'name' => ucfirst($role),
            'email' => $role.'-ai-chat@org.test',
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $organization->id,
        ]);
    }

    public function test_an_admin_may_use_the_assistant(): void
    {
        $organization = $this->organization();
        $admin = $this->userWithRole('admin', $organization);

        $this->postJson('/api/ai/chat', ['message' => 'How many approvals are pending?'], $this->apiHeadersFor($admin))
            ->assertOk()
            ->assertJsonStructure(['reply']);
    }

    public function test_a_super_admin_may_use_the_assistant(): void
    {
        $organization = $this->organization();
        $superAdmin = $this->userWithRole('super_admin', $organization);

        $this->postJson('/api/ai/chat', ['message' => 'Payroll status?'], $this->apiHeadersFor($superAdmin))
            ->assertOk();
    }

    public function test_an_employee_may_not_use_the_assistant(): void
    {
        $organization = $this->organization();
        $employee = $this->userWithRole('employee', $organization);

        $this->postJson('/api/ai/chat', ['message' => 'How many approvals are pending?'], $this->apiHeadersFor($employee))
            ->assertForbidden();
    }

    public function test_a_manager_may_not_use_the_assistant(): void
    {
        $organization = $this->organization();
        $manager = $this->userWithRole('manager', $organization);

        $this->postJson('/api/ai/chat', ['message' => "How's my team doing?"], $this->apiHeadersFor($manager))
            ->assertForbidden();
    }

    /**
     * hr and payroll_manager sit at hierarchy level 20 — they operate payroll
     * but do not administer the organisation. The assistant is an admin tool.
     */
    public function test_an_hr_user_may_not_use_the_assistant(): void
    {
        $organization = $this->organization();
        $hr = $this->userWithRole('hr', $organization);

        $this->postJson('/api/ai/chat', ['message' => 'Headcount?'], $this->apiHeadersFor($hr))
            ->assertForbidden();
    }

    public function test_an_anonymous_visitor_may_not_use_the_in_app_assistant(): void
    {
        $this->postJson('/api/ai/chat', ['message' => 'How many approvals are pending?'], ['Accept' => 'application/json'])
            ->assertForbidden();
    }

    /**
     * The public sales bot stays public. It runs the marketing prompt with no
     * tools and no organisation data, so it has nothing to leak.
     */
    public function test_an_anonymous_visitor_may_use_the_landing_sales_bot(): void
    {
        $this->postJson('/api/ai/chat', [
            'message' => 'What does CareVance cost?',
            'context' => 'landing',
        ], ['Accept' => 'application/json'])
            ->assertOk()
            ->assertJsonStructure(['reply']);
    }

    /**
     * An employee reaching the landing bot is harmless — it has no tools — but
     * it must not become a side door into the admin assistant. Asserting the
     * landing branch stays toolless is what keeps that true.
     */
    public function test_an_employee_passing_the_landing_context_gets_the_toolless_sales_bot(): void
    {
        $organization = $this->organization();
        $employee = $this->userWithRole('employee', $organization);

        $this->postJson('/api/ai/chat', [
            'message' => 'How many people are absent today?',
            'context' => 'landing',
        ], $this->apiHeadersFor($employee))
            ->assertOk()
            // Empty, not absent: every reply carries the key. An empty list is
            // proof no tool ran, which is the property being asserted here.
            ->assertJsonPath('sources', []);
    }
}
