<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use App\Services\Monitoring\MonitoringConsentService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Notice and consent for workforce monitoring.
 *
 * The platform captured screenshots, application and URL activity, geofenced
 * punches and attendance selfies with no consent record, no employee-facing
 * disclosure, no stated purpose and no way to withdraw. Under the DPDP Act the
 * penalty for that lands on the employer running the software, not the vendor
 * that wrote it.
 */
class MonitoringConsentTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;
    private User $employee;
    private MonitoringConsentService $service;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();

        $this->admin = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);

        $this->employee = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);

        $this->service = app(MonitoringConsentService::class);
    }

    private function publishNotice(): void
    {
        $this->actingAs($this->admin)
            ->postJson('/api/monitoring/notice', [
                'body' => 'We capture screen images and application activity during tracked working hours to verify billable work.',
                'purposes' => MonitoringConsentService::DEFAULT_PURPOSES,
                'retention_days' => 90,
            ])
            ->assertStatus(201);
    }

    private function setPolicy(string $policy, ?string $graceEndsAt = null): void
    {
        $monitoring = ['consent_policy' => $policy];

        if ($graceEndsAt !== null) {
            $monitoring['consent_grace_ends_at'] = $graceEndsAt;
        }

        $this->organization->forceFill([
            'settings' => array_merge($this->organization->settings ?? [], ['monitoring' => $monitoring]),
        ])->saveQuietly();

        $this->organization->refresh();
    }

    // --------------------------------------------------------------- notice

    public function test_an_employee_can_read_what_is_collected_about_them(): void
    {
        $this->publishNotice();

        $response = $this->actingAs($this->employee)
            ->getJson('/api/monitoring/consent')
            ->assertOk();

        $this->assertSame(1, $response->json('data.notice.version'));
        $this->assertSame(90, $response->json('data.notice.retention_days'));

        // Every capture type must state a purpose. A notice without one is a
        // disclaimer, not a notice.
        foreach (MonitoringConsentService::CAPTURE_TYPES as $type) {
            $this->assertNotEmpty(
                $response->json("data.capture_types.{$type}.purpose"),
                "{$type} capture has no stated purpose."
            );
        }
    }

    public function test_publishing_supersedes_rather_than_edits(): void
    {
        $this->publishNotice();
        $this->publishNotice();

        $this->assertSame(2, $this->service->activeNotice($this->organization)->version);
    }

    public function test_an_ordinary_employee_cannot_publish_the_notice(): void
    {
        $this->actingAs($this->employee)
            ->postJson('/api/monitoring/notice', [
                'body' => 'We collect nothing at all, honestly, please ignore the screenshots.',
                'purposes' => MonitoringConsentService::DEFAULT_PURPOSES,
                'retention_days' => 1,
            ])
            ->assertStatus(403);
    }

    // -------------------------------------------------------------- consent

    public function test_consent_is_per_capture_type_not_one_blanket_yes(): void
    {
        $this->publishNotice();
        $this->setPolicy('enforced');

        $this->actingAs($this->employee)
            ->postJson('/api/monitoring/consent', ['capture_types' => ['activity']])
            ->assertOk();

        $employee = $this->employee->fresh();

        $this->assertTrue($this->service->isCaptureAllowed($employee, 'activity'));
        $this->assertFalse(
            $this->service->isCaptureAllowed($employee, 'screenshot'),
            'Agreeing to activity tracking is not agreeing to screenshots.'
        );
    }

    public function test_withdrawing_stops_collection(): void
    {
        $this->publishNotice();
        $this->setPolicy('enforced');

        $this->actingAs($this->employee)
            ->postJson('/api/monitoring/consent', ['capture_types' => ['screenshot', 'activity']])
            ->assertOk();

        $this->assertTrue($this->service->isCaptureAllowed($this->employee->fresh(), 'screenshot'));

        $this->actingAs($this->employee)->deleteJson('/api/monitoring/consent')->assertOk();

        $this->assertFalse($this->service->isCaptureAllowed($this->employee->fresh(), 'screenshot'));
    }

    public function test_a_new_notice_version_asks_again_rather_than_inheriting_the_old_answer(): void
    {
        $this->publishNotice();
        $this->setPolicy('enforced');

        $this->actingAs($this->employee)
            ->postJson('/api/monitoring/consent', ['capture_types' => ['screenshot']])
            ->assertOk();

        $this->assertTrue($this->service->isCaptureAllowed($this->employee->fresh(), 'screenshot'));

        // The words changed. Agreement to the old ones is not agreement to
        // these.
        $this->publishNotice();

        $this->assertFalse(
            $this->service->isCaptureAllowed($this->employee->fresh(), 'screenshot'),
            'Consent is recorded against a notice version for exactly this reason.'
        );
    }

    // ----------------------------------------------------------------- gate

    public function test_a_screenshot_is_refused_without_consent(): void
    {
        $this->publishNotice();
        $this->setPolicy('enforced');

        $this->actingAs($this->employee)
            ->postJson('/api/screenshots', ['time_entry_id' => 1])
            ->assertStatus(403)
            ->assertJsonPath('error_code', 'MONITORING_CONSENT_REQUIRED')
            ->assertJsonPath('capture_type', 'screenshot');
    }

    public function test_activity_is_refused_without_consent(): void
    {
        $this->publishNotice();
        $this->setPolicy('enforced');

        $this->actingAs($this->employee)
            ->postJson('/api/activities', ['type' => 'app', 'name' => 'Slack'])
            ->assertStatus(403)
            ->assertJsonPath('error_code', 'MONITORING_CONSENT_REQUIRED');
    }

    public function test_a_selfie_is_refused_without_consent(): void
    {
        $this->publishNotice();
        $this->setPolicy('enforced');

        $this->actingAs($this->employee)
            ->postJson('/api/attendance/selfie', ['image' => 'data:image/png;base64,AAAA'])
            ->assertStatus(403)
            ->assertJsonPath('error_code', 'MONITORING_CONSENT_REQUIRED');
    }

    /**
     * Every ingestion path must be gated. A path somebody forgets is the one
     * that keeps collecting.
     */
    public function test_every_capture_controller_carries_the_guard(): void
    {
        foreach ([
            'ScreenshotController',
            'ActivityController',
            'AttendanceSelfieController',
        ] as $controller) {
            $source = file_get_contents(base_path("app/Http/Controllers/Api/{$controller}.php"));

            $this->assertStringContainsString(
                'GuardsMonitoringConsent',
                $source,
                "{$controller} ingests monitoring data but does not check consent."
            );
        }

        // The geofence path skips rather than refuses — blocking a punch over a
        // location preference would stop someone attending work.
        $this->assertStringContainsString(
            'MonitoringConsentService',
            file_get_contents(base_path('app/Http/Controllers/Api/TimeEntryController.php')),
            'The geofence log must consult consent before recording a location.'
        );
    }

    // --------------------------------------------------------------- policy

    public function test_the_grace_window_keeps_existing_trackers_working(): void
    {
        $this->publishNotice();
        $this->setPolicy('grace');

        // Nothing breaks on the day this ships. Refusing every capture at once
        // is an outage, and an outage gets the control switched back off.
        $this->assertTrue($this->service->isCaptureAllowed($this->employee, 'screenshot'));
    }

    public function test_the_grace_window_closes(): void
    {
        $this->publishNotice();
        $this->setPolicy('grace', now()->subDay()->toIso8601String());

        $this->assertFalse($this->service->isCaptureAllowed($this->employee->fresh(), 'screenshot'));
    }

    public function test_an_organisation_can_switch_monitoring_off_entirely(): void
    {
        $this->publishNotice();

        $this->organization->forceFill([
            'settings' => array_merge($this->organization->settings ?? [], [
                'monitoring' => ['enabled' => false, 'consent_policy' => 'off'],
            ]),
        ])->saveQuietly();

        $this->assertFalse(
            $this->service->isCaptureAllowed($this->employee->fresh(), 'screenshot'),
            'The kill switch must win over every other setting.'
        );
    }

    public function test_enforced_policy_with_no_published_notice_refuses_everything(): void
    {
        $this->setPolicy('enforced');

        $this->assertFalse($this->service->isCaptureAllowed($this->employee->fresh(), 'screenshot'));
        $this->assertStringContainsString(
            'No monitoring notice',
            (string) $this->service->refusalReason($this->employee->fresh(), 'screenshot')
        );
    }

    public function test_the_default_policy_is_grace_not_off(): void
    {
        // An organisation that has never touched the setting still ends up
        // inside the notice-and-consent machinery rather than outside it.
        $this->assertSame('grace', $this->service->policyFor($this->organization));
    }
}
