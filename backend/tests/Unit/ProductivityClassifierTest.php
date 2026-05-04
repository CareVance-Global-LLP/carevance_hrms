<?php

namespace Tests\Unit;

use App\Models\Organization;
use App\Models\ProductivityRule;
use App\Models\User;
use App\Services\Monitoring\ProductivityClassifier;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ProductivityClassifierTest extends TestCase
{
    use RefreshDatabase;

    public function test_normalizer_extracts_domain_from_browser_title(): void
    {
        $result = app(ProductivityClassifier::class)->classifyActivity([
            'type' => 'url',
            'name' => 'GitHub - PR review - Google Chrome',
        ]);

        $this->assertSame('github.com', $result['normalized_domain']);
        $this->assertSame('productive', $result['classification']);
    }

    public function test_workspace_rule_beats_global_rule(): void
    {
        $organization = Organization::create(['name' => 'Acme', 'slug' => 'acme']);
        $user = User::create([
            'name' => 'Example',
            'email' => 'example@acme.test',
            'password' => 'password123',
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        ProductivityRule::create([
            'organization_id' => $organization->id,
            'target_type' => 'app',
            'match_mode' => 'contains',
            'target_value' => 'vscode',
            'classification' => 'unproductive',
            'priority' => 999,
            'scope_type' => 'workspace',
            'scope_id' => $organization->id,
            'is_active' => true,
        ]);

        $result = app(ProductivityClassifier::class)->classifyActivity([
            'user_id' => $user->id,
            'type' => 'app',
            'name' => 'Visual Studio Code',
        ]);

        $this->assertSame('unproductive', $result['classification']);
    }

    public function test_group_rule_beats_user_rule(): void
    {
        $organization = Organization::create(['name' => 'Acme', 'slug' => 'acme']);
        $user = User::create([
            'name' => 'Example',
            'email' => 'group@acme.test',
            'password' => 'password123',
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $group = \App\Models\ReportGroup::create([
            'organization_id' => $organization->id,
            'name' => 'Engineering',
        ]);
        $user->reportGroups()->attach($group->id);

        ProductivityRule::create([
            'organization_id' => $organization->id,
            'target_type' => 'app',
            'match_mode' => 'contains',
            'target_value' => 'whatsapp',
            'classification' => 'productive',
            'priority' => 500,
            'scope_type' => 'group',
            'scope_id' => $group->id,
            'is_active' => true,
        ]);

        ProductivityRule::create([
            'organization_id' => $organization->id,
            'target_type' => 'app',
            'match_mode' => 'contains',
            'target_value' => 'whatsapp',
            'classification' => 'unproductive',
            'priority' => 400,
            'scope_type' => 'user',
            'scope_id' => $user->id,
            'is_active' => true,
        ]);

        $result = app(ProductivityClassifier::class)->classifyActivity([
            'user_id' => $user->id,
            'type' => 'app',
            'name' => 'WhatsApp',
        ]);

        $this->assertSame('productive', $result['classification']);
    }

    public function test_unknown_activity_defaults_to_neutral(): void
    {
        $result = app(ProductivityClassifier::class)->classifyContext([
            'raw_name' => 'Some New App',
            'activity_type' => 'app',
        ]);

        $this->assertSame('neutral', $result['classification']);
    }

    public function test_classifier_prefers_domain_when_browser_url_is_available(): void
    {
        $result = app(ProductivityClassifier::class)->classifyActivity([
            'type' => 'url',
            'name' => 'GitHub',
            'app_name' => 'Google Chrome',
            'window_title' => 'OpenAI/Codex - Pull requests - Google Chrome',
            'url' => 'https://github.com/openai/codex/pulls',
        ]);

        $this->assertSame('github.com', $result['normalized_domain']);
        $this->assertSame('github.com', $result['normalized_label']);
        $this->assertSame('website', $result['tool_type']);
    }

    public function test_classifier_falls_back_to_software_name_when_browser_url_is_missing(): void
    {
        $result = app(ProductivityClassifier::class)->classifyActivity([
            'type' => 'app',
            'name' => 'Google Chrome',
            'app_name' => 'Google Chrome',
            'window_title' => 'Google Chrome',
            'url' => null,
        ]);

        $this->assertNull($result['normalized_domain']);
        $this->assertSame('google chrome', $result['software_name']);
        $this->assertSame('software', $result['tool_type']);
    }

    public function test_classifier_uses_keyword_fallback_for_browser_titles_when_url_is_missing(): void
    {
        $result = app(ProductivityClassifier::class)->classifyActivity([
            'type' => 'url',
            'name' => 'Instagram - Google Chrome',
            'app_name' => 'Google Chrome',
            'window_title' => 'Instagram - Google Chrome',
            'url' => null,
        ]);

        $this->assertSame('instagram.com', $result['normalized_domain']);
        $this->assertSame('unproductive', $result['classification']);
    }

    public function test_classifier_treats_linkedin_as_productive_consistently(): void
    {
        $result = app(ProductivityClassifier::class)->classifyActivity([
            'type' => 'url',
            'name' => 'Feed | LinkedIn',
            'app_name' => 'Google Chrome',
            'window_title' => 'Feed | LinkedIn - Google Chrome',
            'url' => 'https://www.linkedin.com/feed/',
        ]);

        $this->assertSame('linkedin.com', $result['normalized_domain']);
        $this->assertSame('productive', $result['classification']);
    }

    public function test_classifier_treats_codex_as_productive_app_usage(): void
    {
        $result = app(ProductivityClassifier::class)->classifyActivity([
            'type' => 'app',
            'name' => 'Codex',
            'app_name' => 'Codex',
            'window_title' => 'Codex',
            'url' => null,
        ]);

        $this->assertSame('codex', $result['software_name']);
        $this->assertSame('productive', $result['classification']);
    }

    public function test_classifier_uses_keyword_fallback_for_browser_internal_pages(): void
    {
        $result = app(ProductivityClassifier::class)->classifyActivity([
            'type' => 'url',
            'name' => 'Extensions',
            'app_name' => 'Google Chrome',
            'window_title' => 'Extensions',
            'url' => 'chrome://extensions',
        ]);

        $this->assertSame('browser extensions', $result['normalized_label']);
        $this->assertSame('productive', $result['classification']);
        $this->assertSame('website', $result['tool_type']);
    }
}
