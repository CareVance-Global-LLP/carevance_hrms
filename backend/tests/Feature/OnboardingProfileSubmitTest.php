<?php

namespace Tests\Feature;

use App\Models\EmployeeProfile;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The first-login profile form has to be submittable.
 *
 * It was not. `display_name` was `required` on this endpoint while
 * ProfileOnboardingPage never collected it, never sent it, and did not even
 * carry it on its form type — so a joiner who filled in every visible field got
 * a 422 on every attempt, naming a field that was not on the screen. The only
 * way past the page was Skip, which is why fresh employees ended up with empty
 * profiles.
 *
 * The first test here is the exact payload that form sends. If it ever fails
 * again, the page is unusable again.
 */
class OnboardingProfileSubmitTest extends TestCase
{
    use RefreshDatabase;

    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();

        $organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance-onboarding-submit',
        ]);

        $this->employee = User::create([
            'name' => 'Ava Employee',
            'email' => 'ava@carevance.test',
            'password' => bcrypt('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);
    }

    /**
     * Exactly what ProfileOnboardingPage puts on the wire — no display_name,
     * because the form has no such field.
     */
    private function formPayload(array $overrides = []): array
    {
        return array_merge([
            'first_name' => 'Ava',
            'last_name' => 'Sharma',
            'gender' => 'female',
            'date_of_birth' => '1996-04-12',
            'phone' => '9876543210',
            'personal_email' => 'ava.personal@example.test',
            'address_line' => '12 MG Road',
            'city' => 'Ahmedabad',
            'state' => 'Gujarat',
            'postal_code' => '380001',
            'emergency_contact_name' => 'Ravi Sharma',
            'emergency_contact_number' => '9876500000',
            'emergency_contact_relationship' => 'Sibling',
            'blood_group' => 'O+',
            'permanent_address_line' => '',
            'permanent_city' => '',
            'permanent_state' => '',
            'permanent_postal_code' => '',
        ], $overrides);
    }

    public function test_the_payload_the_form_actually_sends_is_accepted(): void
    {
        $this->actingAs($this->employee)
            ->putJson('/api/settings/onboarding-profile', $this->formPayload())
            ->assertSuccessful();

        $profile = EmployeeProfile::query()->where('user_id', $this->employee->id)->firstOrFail();

        $this->assertSame('Ava', $profile->first_name);
        $this->assertSame('Ahmedabad', $profile->city);
    }

    public function test_a_display_name_is_derived_from_the_names_the_joiner_typed(): void
    {
        // Nobody should have to type their name a third time, but the column
        // still has to be populated for everything downstream that reads it.
        $this->actingAs($this->employee)
            ->putJson('/api/settings/onboarding-profile', $this->formPayload())
            ->assertSuccessful();

        $profile = EmployeeProfile::query()->where('user_id', $this->employee->id)->firstOrFail();

        $this->assertSame('Ava Sharma', $profile->display_name);
    }

    public function test_an_explicit_display_name_is_kept(): void
    {
        // So a preferred name, if one is ever collected, is not overwritten by
        // the derivation.
        $this->actingAs($this->employee)
            ->putJson('/api/settings/onboarding-profile', $this->formPayload([
                'display_name' => 'Avi',
            ]))
            ->assertSuccessful();

        $this->assertSame(
            'Avi',
            EmployeeProfile::query()->where('user_id', $this->employee->id)->value('display_name')
        );
    }

    public function test_completing_the_form_marks_onboarding_done(): void
    {
        $this->actingAs($this->employee)
            ->putJson('/api/settings/onboarding-profile', $this->formPayload())
            ->assertSuccessful();

        $settings = $this->employee->fresh()->settings;

        $this->assertTrue((bool) ($settings['profile_onboarding_completed'] ?? false));
    }

    // ------------------------------------------------- what the client reads

    public function test_a_bad_email_is_reported_against_its_own_field(): void
    {
        /*
         * The page maps `errors.<field>` onto the control it belongs to, so this
         * key is a contract now, not an implementation detail. A 422 carrying
         * only a prose `message` is what produced "your data is invalid" with
         * nothing to act on.
         */
        $response = $this->actingAs($this->employee)
            ->putJson('/api/settings/onboarding-profile', $this->formPayload([
                'personal_email' => 'not-an-email',
            ]));

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['personal_email']);
    }

    public function test_a_missing_required_field_is_reported_against_its_own_field(): void
    {
        $response = $this->actingAs($this->employee)
            ->putJson('/api/settings/onboarding-profile', $this->formPayload([
                'emergency_contact_number' => '',
            ]));

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['emergency_contact_number']);
    }

    public function test_the_optional_fields_really_are_optional(): void
    {
        // Blank permanent address and blood group must not block a joiner; they
        // are reported through the completeness registry instead.
        $this->actingAs($this->employee)
            ->putJson('/api/settings/onboarding-profile', $this->formPayload([
                'blood_group' => '',
                'permanent_address_line' => '',
            ]))
            ->assertSuccessful();
    }
}
