<?php

namespace Tests\Feature;

use App\Models\EmployeeDocument;
use App\Models\EmployeeEducation;
use App\Models\EmployeeProfile;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * The employee details an HR record was missing, and who may write them.
 *
 * Two of these fields are new columns and one is a new table, but the rule
 * being pinned is the same in every case: the details are OPTIONAL at the API,
 * and reported as incomplete rather than refused. Requiring them would have
 * made every employee already on the system unsaveable until somebody sourced a
 * permanent address and a blood group for them.
 *
 * The certificate assertions matter more than they look. An education
 * certificate is a personal document, and the only upload path in this
 * application that puts a file on a private disk behind an authenticated,
 * org-scoped download is EmployeeWorkspaceService::storeDocument. These tests
 * fail if a future change quietly routes it to the public disk instead.
 */
class EmployeePersonalDetailsTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;
    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('employee_documents');

        $this->organization = Organization::factory()->create();

        $this->admin = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);

        $this->employee = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);

        EmployeeProfile::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
        ]);
    }

    #[Test]
    public function an_admin_can_write_the_new_personal_details(): void
    {
        $this->actingAs($this->admin)
            ->putJson("/api/employees/{$this->employee->id}/profile", [
                'first_name' => 'Ayush',
                'middle_name' => 'Kumar',
                'last_name' => 'Borwal',
                'blood_group' => 'O+',
                'permanent_address_line' => '12 Old Village Road',
                'permanent_city' => 'Udaipur',
                'permanent_state' => 'Rajasthan',
                'permanent_postal_code' => '313001',
            ])
            ->assertStatus(200);

        $profile = EmployeeProfile::where('user_id', $this->employee->id)->firstOrFail();

        $this->assertSame('O+', $profile->blood_group);
        $this->assertSame('12 Old Village Road', $profile->permanent_address_line);
        $this->assertSame('Udaipur', $profile->permanent_city);
        $this->assertSame('Rajasthan', $profile->permanent_state);
        $this->assertSame('313001', $profile->permanent_postal_code);
    }

    /**
     * The permanent address is a separate fact from the current one. Writing one
     * must not disturb the other, or an employee who relocates loses the address
     * their PF nomination and bank KYC are registered against.
     */
    #[Test]
    public function the_current_and_permanent_addresses_are_independent(): void
    {
        $this->actingAs($this->admin)
            ->putJson("/api/employees/{$this->employee->id}/profile", [
                'address_line' => '4 Church Street',
                'city' => 'Bengaluru',
                'permanent_address_line' => '12 Old Village Road',
                'permanent_city' => 'Udaipur',
            ])
            ->assertStatus(200);

        $this->actingAs($this->admin)
            ->putJson("/api/employees/{$this->employee->id}/profile", [
                'address_line' => '9 Residency Road',
                'city' => 'Bengaluru',
            ])
            ->assertStatus(200);

        $profile = EmployeeProfile::where('user_id', $this->employee->id)->firstOrFail();

        $this->assertSame('9 Residency Road', $profile->address_line);
        $this->assertSame('12 Old Village Road', $profile->permanent_address_line, 'Moving house must not erase the permanent address.');
    }

    /**
     * Optional at the API, by design. The completeness registry is what reports
     * them as missing; nothing here refuses a save.
     */
    #[Test]
    public function the_new_details_are_optional(): void
    {
        $this->actingAs($this->admin)
            ->putJson("/api/employees/{$this->employee->id}/profile", ['first_name' => 'Ayush'])
            ->assertStatus(200);
    }

    #[Test]
    public function an_employee_can_write_their_own_new_details(): void
    {
        $this->actingAs($this->employee)
            ->putJson("/api/employees/{$this->employee->id}/profile", ['blood_group' => 'B-'])
            ->assertStatus(200);

        $this->assertSame('B-', EmployeeProfile::where('user_id', $this->employee->id)->firstOrFail()->blood_group);
    }

    #[Test]
    public function a_stranger_cannot_write_another_employees_details(): void
    {
        $otherOrg = Organization::factory()->create();
        $stranger = User::factory()->create(['organization_id' => $otherOrg->id, 'role' => 'admin']);

        $this->actingAs($stranger)
            ->putJson("/api/employees/{$this->employee->id}/profile", ['blood_group' => 'A+'])
            ->assertStatus(403);

        // withoutOrganizationScope, because the acting user is still the
        // stranger and the global scope would otherwise hide the very row this
        // is checking was left alone.
        $this->assertNull(
            EmployeeProfile::withoutOrganizationScope()->where('user_id', $this->employee->id)->firstOrFail()->blood_group
        );
    }

    #[Test]
    public function an_education_record_is_created_with_its_facts(): void
    {
        $response = $this->actingAs($this->admin)
            ->postJson("/api/employees/{$this->employee->id}/educations", [
                'qualification' => 'B.Tech',
                'institution' => 'NIT Surat',
                'specialisation' => 'Computer Engineering',
                'year_of_passing' => 2018,
                'grade' => '8.4 CGPA',
            ])
            ->assertStatus(201);

        $this->assertSame('B.Tech', $response->json('qualification'));

        $record = EmployeeEducation::firstOrFail();
        $this->assertSame($this->employee->id, $record->user_id);
        $this->assertSame(2018, $record->year_of_passing);
        $this->assertNull($record->employee_document_id, 'No file was sent, so nothing should be attached.');
    }

    /**
     * Several qualifications per person is the ordinary case in this market —
     * 10th, 12th, graduation, post-graduation — and is the whole reason this is
     * a table rather than a column.
     */
    #[Test]
    public function an_employee_can_hold_several_qualifications(): void
    {
        foreach (['10th', '12th', 'B.Tech', 'M.Tech'] as $qualification) {
            $this->actingAs($this->admin)
                ->postJson("/api/employees/{$this->employee->id}/educations", ['qualification' => $qualification])
                ->assertStatus(201);
        }

        $this->assertSame(4, EmployeeEducation::count());
    }

    /** Two qualifications can share a name, so only an explicit id replaces a row. */
    #[Test]
    public function a_second_qualification_with_the_same_name_does_not_overwrite_the_first(): void
    {
        $this->actingAs($this->admin)
            ->postJson("/api/employees/{$this->employee->id}/educations", [
                'qualification' => 'B.Sc',
                'institution' => 'Delhi University',
            ])->assertStatus(201);

        $this->actingAs($this->admin)
            ->postJson("/api/employees/{$this->employee->id}/educations", [
                'qualification' => 'B.Sc',
                'institution' => 'Mumbai University',
            ])->assertStatus(201);

        $this->assertSame(2, EmployeeEducation::count());
    }

    #[Test]
    public function passing_an_id_edits_the_row_rather_than_adding_one(): void
    {
        $created = $this->actingAs($this->admin)
            ->postJson("/api/employees/{$this->employee->id}/educations", ['qualification' => 'B.Tech'])
            ->json('id');

        $this->actingAs($this->admin)
            ->postJson("/api/employees/{$this->employee->id}/educations", [
                'id' => $created,
                'qualification' => 'B.Tech',
                'grade' => '8.4 CGPA',
            ])
            ->assertStatus(200);

        $this->assertSame(1, EmployeeEducation::count());
        $this->assertSame('8.4 CGPA', EmployeeEducation::firstOrFail()->grade);
    }

    /**
     * The certificate goes where every other employee document goes: the private
     * employee_documents disk, reachable only through the authenticated,
     * org-scoped download route.
     */
    #[Test]
    public function a_certificate_becomes_an_employee_document_on_the_private_disk(): void
    {
        $this->actingAs($this->admin)
            ->post("/api/employees/{$this->employee->id}/educations", [
                'qualification' => 'B.Tech',
                'certificate_file' => UploadedFile::fake()->create('degree.pdf', 200, 'application/pdf'),
            ])
            ->assertStatus(201);

        $record = EmployeeEducation::firstOrFail();
        $this->assertNotNull($record->employee_document_id, 'The certificate must be linked to the qualification.');

        $document = EmployeeDocument::findOrFail($record->employee_document_id);
        $this->assertSame('education_certificate', $document->category);
        $this->assertSame($this->employee->id, $document->user_id);

        Storage::disk('employee_documents')->assertExists($document->file_path);
    }

    /** Editing the facts without resending the file must not detach it. */
    #[Test]
    public function editing_a_qualification_keeps_its_existing_certificate(): void
    {
        $this->actingAs($this->admin)
            ->post("/api/employees/{$this->employee->id}/educations", [
                'qualification' => 'B.Tech',
                'certificate_file' => UploadedFile::fake()->create('degree.pdf', 200, 'application/pdf'),
            ])->assertStatus(201);

        $record = EmployeeEducation::firstOrFail();
        $documentId = $record->employee_document_id;

        $this->actingAs($this->admin)
            ->postJson("/api/employees/{$this->employee->id}/educations", [
                'id' => $record->id,
                'qualification' => 'B.Tech',
                'institution' => 'NIT Surat',
            ])->assertStatus(200);

        $this->assertSame($documentId, EmployeeEducation::firstOrFail()->employee_document_id);
    }

    #[Test]
    public function the_certificate_download_is_scoped_to_the_owning_organisation(): void
    {
        $this->actingAs($this->admin)
            ->post("/api/employees/{$this->employee->id}/educations", [
                'qualification' => 'B.Tech',
                'certificate_file' => UploadedFile::fake()->create('degree.pdf', 200, 'application/pdf'),
            ])->assertStatus(201);

        $documentId = EmployeeEducation::firstOrFail()->employee_document_id;

        $otherOrg = Organization::factory()->create();
        $stranger = User::factory()->create(['organization_id' => $otherOrg->id, 'role' => 'admin']);

        $this->actingAs($stranger)
            ->get("/api/employees/{$this->employee->id}/documents/{$documentId}/download")
            ->assertStatus(403);
    }

    /** A four-digit typo in a year is silent and permanent otherwise. */
    #[Test]
    public function an_implausible_year_of_passing_is_refused(): void
    {
        $this->actingAs($this->admin)
            ->postJson("/api/employees/{$this->employee->id}/educations", [
                'qualification' => 'B.Tech',
                'year_of_passing' => 200,
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('year_of_passing');
    }

    #[Test]
    public function a_qualification_is_required(): void
    {
        $this->actingAs($this->admin)
            ->postJson("/api/employees/{$this->employee->id}/educations", ['institution' => 'NIT Surat'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('qualification');
    }

    #[Test]
    public function an_employee_cannot_record_their_own_qualifications(): void
    {
        $this->actingAs($this->employee)
            ->postJson("/api/employees/{$this->employee->id}/educations", ['qualification' => 'PhD'])
            ->assertStatus(403);

        $this->assertSame(0, EmployeeEducation::count());
    }

    #[Test]
    public function removing_a_qualification_leaves_its_certificate_on_file(): void
    {
        $this->actingAs($this->admin)
            ->post("/api/employees/{$this->employee->id}/educations", [
                'qualification' => 'B.Tech',
                'certificate_file' => UploadedFile::fake()->create('degree.pdf', 200, 'application/pdf'),
            ])->assertStatus(201);

        $record = EmployeeEducation::firstOrFail();

        $this->actingAs($this->admin)
            ->deleteJson("/api/employees/{$this->employee->id}/educations/{$record->id}")
            ->assertStatus(200);

        $this->assertSame(0, EmployeeEducation::count());
        $this->assertSame(1, EmployeeDocument::count(), 'The document is evidence in its own right and is not deleted with the row.');
    }

    #[Test]
    public function a_qualification_in_another_organisation_is_not_found(): void
    {
        $this->actingAs($this->admin)
            ->postJson("/api/employees/{$this->employee->id}/educations", ['qualification' => 'B.Tech'])
            ->assertStatus(201);

        $recordId = EmployeeEducation::firstOrFail()->id;

        $otherOrg = Organization::factory()->create();
        $stranger = User::factory()->create(['organization_id' => $otherOrg->id, 'role' => 'admin']);

        $this->actingAs($stranger)
            ->deleteJson("/api/employees/{$this->employee->id}/educations/{$recordId}")
            ->assertStatus(403);

        // Scope-free for the same reason: the stranger is still the acting
        // user, and a scoped count would report 0 whether or not the row
        // survived.
        $this->assertSame(1, EmployeeEducation::withoutOrganizationScope()->count());
    }

    #[Test]
    public function the_workspace_payload_carries_the_qualifications(): void
    {
        $this->actingAs($this->admin)
            ->postJson("/api/employees/{$this->employee->id}/educations", [
                'qualification' => 'B.Tech',
                'year_of_passing' => 2018,
            ])->assertStatus(201);

        $this->actingAs($this->admin)
            ->getJson("/api/employees/{$this->employee->id}/workspace")
            ->assertStatus(200)
            ->assertJsonPath('educations.0.qualification', 'B.Tech');
    }
}
