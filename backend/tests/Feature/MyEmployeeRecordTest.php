<?php

namespace Tests\Feature;

use App\Models\EmployeeBankAccount;
use App\Models\EmployeeDocument;
use App\Models\EmployeeEducation;
use App\Models\EmployeeGovernmentId;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Employee self-service for bank details, government IDs and documents.
 *
 * Until these routes existed an employee could not supply their own KYC: every
 * write lived behind `role:admin,manager`, so PAN and a bank account — both
 * marked requiredForPayroll, and both declared employee-owned by the profile
 * registry — could only be typed in by somebody else. Payroll stalled on an
 * admin transcribing account numbers from an email.
 *
 * Deliberately NOT using WithoutMiddleware. The role gate is the thing under
 * test; bypassing it would assert nothing.
 */
class MyEmployeeRecordTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $employee;
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        Storage::fake('public');

        $this->organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance-self-service',
        ]);

        $this->employee = User::create([
            'name' => 'Ava Employee',
            'email' => 'ava@carevance.test',
            'password' => bcrypt('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);

        $this->admin = User::create([
            'name' => 'Admin User',
            'email' => 'admin@carevance.test',
            'password' => bcrypt('password123'),
            'role' => 'admin',
            'organization_id' => $this->organization->id,
        ]);
    }

    // ------------------------------------------------------- the happy path

    public function test_an_employee_can_save_their_own_bank_account(): void
    {
        $response = $this->actingAs($this->employee)->postJson('/api/me/bank-accounts', [
            'bank_name' => 'HDFC Bank',
            'account_number' => '50100123456789',
            'ifsc_swift' => 'HDFC0001234',
            'account_holder_name' => 'Ava Employee',
            'is_default' => true,
        ]);

        $response->assertCreated();

        $account = EmployeeBankAccount::query()->where('user_id', $this->employee->id)->first();

        $this->assertNotNull($account);
        $this->assertSame('50100123456789', $account->account_number);
        $this->assertSame('HDFC0001234', $account->ifsc_swift);
        $this->assertSame($this->organization->id, $account->organization_id);
    }

    public function test_an_employee_can_save_their_own_government_id(): void
    {
        $response = $this->actingAs($this->employee)->postJson('/api/me/government-ids', [
            'id_type' => 'pan',
            'id_number' => 'ABCPE1234F',
        ]);

        $response->assertCreated();

        $record = EmployeeGovernmentId::query()->where('user_id', $this->employee->id)->first();

        $this->assertNotNull($record);
        $this->assertSame('ABCPE1234F', $record->id_number);
    }

    public function test_a_badly_formatted_id_is_refused_exactly_as_on_the_admin_path(): void
    {
        $this->actingAs($this->employee)
            ->postJson('/api/me/government-ids', ['id_type' => 'pan', 'id_number' => 'NOTAPAN'])
            ->assertStatus(422);

        $this->assertSame(0, EmployeeGovernmentId::query()->where('user_id', $this->employee->id)->count());
    }

    public function test_an_employee_reads_back_their_own_records(): void
    {
        EmployeeGovernmentId::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'id_type' => 'PAN',
            'id_number' => 'ABCPE1234F',
        ]);

        $response = $this->actingAs($this->employee)->getJson('/api/me/employee-records');

        $response->assertOk();
        $response->assertJsonPath('government_ids.0.id_type', 'PAN');
        $response->assertJsonStructure(['employee', 'bank_accounts', 'government_ids', 'documents']);
    }

    // ------------------------------------------------- never somebody else's

    public function test_an_employee_cannot_reach_another_persons_record(): void
    {
        $colleague = User::create([
            'name' => 'Other Person',
            'email' => 'other@carevance.test',
            'password' => bcrypt('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);

        // The admin-only routes stay admin-only. Adding /me/* must not have
        // loosened the id-addressed ones.
        $this->actingAs($this->employee)
            ->getJson("/api/employees/{$colleague->id}/workspace")
            ->assertForbidden();

        $this->actingAs($this->employee)
            ->postJson("/api/employees/{$colleague->id}/bank-accounts", [
                'bank_name' => 'Diverted Bank',
                'account_number' => '50100000000001',
                'ifsc_swift' => 'HDFC0001234',
            ])
            ->assertForbidden();

        $this->assertSame(0, EmployeeBankAccount::query()->where('user_id', $colleague->id)->count());
    }

    public function test_a_forged_user_id_in_the_body_is_ignored(): void
    {
        $colleague = User::create([
            'name' => 'Other Person',
            'email' => 'other2@carevance.test',
            'password' => bcrypt('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);

        $this->actingAs($this->employee)->postJson('/api/me/bank-accounts', [
            'user_id' => $colleague->id,
            'organization_id' => 9999,
            'bank_name' => 'HDFC Bank',
            'account_number' => '50100123456789',
            'ifsc_swift' => 'HDFC0001234',
        ])->assertCreated();

        // The subject is always the authenticated user, never what was posted.
        $this->assertSame(0, EmployeeBankAccount::query()->where('user_id', $colleague->id)->count());
        $this->assertSame(1, EmployeeBankAccount::query()->where('user_id', $this->employee->id)->count());
    }

    public function test_an_employee_cannot_overwrite_another_persons_row_by_id(): void
    {
        $colleague = User::create([
            'name' => 'Other Person',
            'email' => 'other3@carevance.test',
            'password' => bcrypt('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);

        $theirs = EmployeeGovernmentId::create([
            'organization_id' => $this->organization->id,
            'user_id' => $colleague->id,
            'id_type' => 'PAN',
            'id_number' => 'ZZZZZ9999Z',
        ]);

        $this->actingAs($this->employee)->postJson('/api/me/government-ids', [
            'id' => $theirs->id,
            'id_type' => 'pan',
            'id_number' => 'ABCPE1234F',
        ])->assertCreated();

        // Their row is untouched; a new row was created for the actor instead.
        $this->assertSame('ZZZZZ9999Z', $theirs->fresh()->id_number);
        $this->assertSame(1, EmployeeGovernmentId::query()->where('user_id', $this->employee->id)->count());
    }

    // -------------------------------------------------- the honest audit trail

    public function test_a_self_declared_id_does_not_claim_to_have_been_reviewed(): void
    {
        // Trusted immediately means the record is USABLE at once, not that the
        // audit trail may say HR checked it. An employee is never their own
        // reviewer.
        $this->actingAs($this->employee)->postJson('/api/me/government-ids', [
            'id_type' => 'pan',
            'id_number' => 'ABCPE1234F',
            'status' => 'verified',
        ])->assertCreated();

        $record = EmployeeGovernmentId::query()->where('user_id', $this->employee->id)->first();

        $this->assertNull($record->reviewed_by);
        $this->assertNull($record->reviewed_at);
        $this->assertNotSame('verified', $record->status);
    }

    // ------------------------------------------------------------- documents

    public function test_an_employee_sees_only_the_documents_they_uploaded(): void
    {
        $this->actingAs($this->employee)->post('/api/me/documents', [
            'title' => 'My address proof',
            'category' => 'address_proof',
            'file' => UploadedFile::fake()->create('proof.pdf', 12, 'application/pdf'),
        ])->assertCreated();

        // Something HR put on the record. There is no confidential flag on
        // employee_documents, so anything an admin uploads could be a warning
        // letter or a background check — none of it is the employee's to see.
        $this->actingAs($this->admin)->post("/api/employees/{$this->employee->id}/documents", [
            'title' => 'Internal performance note',
            'category' => 'hr_internal',
            'file' => UploadedFile::fake()->create('note.pdf', 12, 'application/pdf'),
        ])->assertCreated();

        $response = $this->actingAs($this->employee)->getJson('/api/me/employee-records');

        $response->assertOk();
        $titles = collect($response->json('documents'))->pluck('title');

        $this->assertContains('My address proof', $titles);
        $this->assertNotContains('Internal performance note', $titles);
    }

    public function test_an_employee_cannot_download_a_document_hr_uploaded_about_them(): void
    {
        $this->actingAs($this->admin)->post("/api/employees/{$this->employee->id}/documents", [
            'title' => 'Internal performance note',
            'category' => 'hr_internal',
            'file' => UploadedFile::fake()->create('note.pdf', 12, 'application/pdf'),
        ])->assertCreated();

        $document = EmployeeDocument::query()->where('user_id', $this->employee->id)->firstOrFail();

        $this->actingAs($this->employee)
            ->get("/api/me/documents/{$document->id}/download")
            ->assertForbidden();
    }

    public function test_an_employee_can_download_a_document_they_uploaded_themselves(): void
    {
        $this->actingAs($this->employee)->post('/api/me/documents', [
            'title' => 'My address proof',
            'category' => 'address_proof',
            'file' => UploadedFile::fake()->create('proof.pdf', 12, 'application/pdf'),
        ])->assertCreated();

        $document = EmployeeDocument::query()->where('user_id', $this->employee->id)->firstOrFail();

        $this->actingAs($this->employee)
            ->get("/api/me/documents/{$document->id}/download")
            ->assertOk();
    }

    public function test_the_employees_own_profile_details_come_back(): void
    {
        /*
         * The regression this closes: Settings > Profile read personal details
         * through /employees/{id}/workspace, which is gated on
         * role:admin,manager. An employee was refused by the middleware and a
         * manager by the scope check — their own hierarchy level is not BELOW
         * their own — so only an admin ever saw data. Everybody else got a blank
         * form, and nothing HR filled in for them arrived.
         */
        $this->actingAs($this->admin)->putJson("/api/employees/{$this->employee->id}/profile", [
            'first_name' => 'Ava',
            'city' => 'Ahmedabad',
        ])->assertSuccessful();

        $response = $this->actingAs($this->employee)->getJson('/api/me/employee-records');

        $response->assertOk();
        $response->assertJsonPath('about.first_name', 'Ava');
        $response->assertJsonPath('about.city', 'Ahmedabad');
    }

    public function test_a_document_hr_shared_is_visible_and_downloadable(): void
    {
        $this->actingAs($this->admin)->post("/api/employees/{$this->employee->id}/documents", [
            'title' => 'Offer letter',
            'category' => 'other',
            'visible_to_employee' => '1',
            'file' => UploadedFile::fake()->create('offer.pdf', 12, 'application/pdf'),
        ])->assertCreated();

        $document = EmployeeDocument::query()->where('title', 'Offer letter')->firstOrFail();

        $titles = collect($this->actingAs($this->employee)->getJson('/api/me/employee-records')->json('documents'))
            ->pluck('title');
        $this->assertContains('Offer letter', $titles);

        $this->actingAs($this->employee)
            ->get("/api/me/documents/{$document->id}/download")
            ->assertOk();
    }

    public function test_an_unshared_document_stays_invisible_by_default(): void
    {
        // Default false is what keeps a warning letter or a background check
        // private without HR having to remember to hide it.
        $this->actingAs($this->admin)->post("/api/employees/{$this->employee->id}/documents", [
            'title' => 'Internal note',
            'category' => 'hr_internal',
            'file' => UploadedFile::fake()->create('note.pdf', 12, 'application/pdf'),
        ])->assertCreated();

        $document = EmployeeDocument::query()->where('title', 'Internal note')->firstOrFail();

        $this->assertFalse((bool) $document->visible_to_employee);

        $titles = collect($this->actingAs($this->employee)->getJson('/api/me/employee-records')->json('documents'))
            ->pluck('title');
        $this->assertNotContains('Internal note', $titles);

        $this->actingAs($this->employee)
            ->get("/api/me/documents/{$document->id}/download")
            ->assertForbidden();
    }

    public function test_editing_an_id_clears_the_review_that_was_of_the_old_value(): void
    {
        $this->actingAs($this->admin)->post("/api/employees/{$this->employee->id}/government-ids", [
            'id_type' => 'pan',
            'id_number' => 'ABCPE1234F',
            'status' => 'verified',
        ])->assertCreated();

        $record = EmployeeGovernmentId::query()->where('user_id', $this->employee->id)->firstOrFail();
        $this->assertSame($this->admin->id, $record->reviewed_by);

        $this->actingAs($this->employee)->postJson('/api/me/government-ids', [
            'id_type' => 'pan',
            'id_number' => 'AAAPE9999Z',
        ])->assertOk();

        $record->refresh();
        $this->assertSame('AAAPE9999Z', $record->id_number);
        // Otherwise the row reads "pending, reviewed by <admin>" — a review of a
        // number that is no longer there.
        $this->assertNull($record->reviewed_by);
        $this->assertNull($record->reviewed_at);
    }

    public function test_a_proof_uploaded_with_a_government_id_is_listed_and_downloadable(): void
    {
        // The exact path the employee panel uses: save a government ID with a
        // proof file, then press the eye/download buttons on that row.
        $this->actingAs($this->employee)->post('/api/me/government-ids', [
            'id_type' => 'pan',
            'id_number' => 'ABCPE1234F',
            'proof_file' => UploadedFile::fake()->create('pan.pdf', 12, 'application/pdf'),
        ])->assertCreated();

        $records = $this->actingAs($this->employee)->getJson('/api/me/employee-records');
        $records->assertOk();

        $documentId = $records->json('government_ids.0.document.id');
        $this->assertNotNull($documentId, 'The government ID row must carry its proof document.');

        $this->actingAs($this->employee)
            ->get("/api/me/documents/{$documentId}/download")
            ->assertOk();
    }

    public function test_a_proof_the_admin_attached_to_the_employees_own_id_is_downloadable(): void
    {
        /*
         * A proof of YOUR OWN PAN is not an HR-internal document. It is evidence
         * of a fact you supplied, so who typed it in does not decide whether you
         * may look at it.
         *
         * This is what broke the employee panel: the government-ID row exposes
         * its attached document either way, so the UI rendered eye and download
         * buttons for a file the API then refused — and the handlers had no
         * error path, so it read as "the buttons do nothing".
         */
        $this->actingAs($this->admin)->post("/api/employees/{$this->employee->id}/government-ids", [
            'id_type' => 'pan',
            'id_number' => 'ABCPE1234F',
            'proof_file' => UploadedFile::fake()->create('pan.pdf', 12, 'application/pdf'),
        ])->assertCreated();

        $records = $this->actingAs($this->employee)->getJson('/api/me/employee-records');
        $documentId = $records->json('government_ids.0.document.id');

        $this->assertNotNull($documentId, 'The row carries the proof, so the buttons render.');

        $this->actingAs($this->employee)
            ->get("/api/me/documents/{$documentId}/download")
            ->assertOk();
    }

    public function test_a_bank_proof_the_admin_attached_is_downloadable_too(): void
    {
        $this->actingAs($this->admin)->post("/api/employees/{$this->employee->id}/bank-accounts", [
            'bank_name' => 'HDFC Bank',
            'account_number' => '50100123456789',
            'ifsc_swift' => 'HDFC0001234',
            'proof_file' => UploadedFile::fake()->create('cheque.pdf', 12, 'application/pdf'),
        ])->assertCreated();

        $records = $this->actingAs($this->employee)->getJson('/api/me/employee-records');
        $documentId = $records->json('bank_accounts.0.document.id');

        $this->assertNotNull($documentId);

        $this->actingAs($this->employee)
            ->get("/api/me/documents/{$documentId}/download")
            ->assertOk();
    }

    // ------------------------------------------------------------- education

    public function test_an_employee_can_record_their_own_qualification(): void
    {
        $response = $this->actingAs($this->employee)->post('/api/me/educations', [
            'qualification' => 'B.Tech',
            'institution' => 'NIT Surat',
            'year_of_passing' => 2019,
            'certificate_file' => UploadedFile::fake()->create('degree.pdf', 12, 'application/pdf'),
        ]);

        $response->assertCreated();

        $record = EmployeeEducation::query()->where('user_id', $this->employee->id)->firstOrFail();
        $this->assertSame('B.Tech', $record->qualification);
        // The certificate rides along on the same private disk the admin path
        // uses, rather than acquiring storage of its own.
        $this->assertNotNull($record->employee_document_id);
    }

    public function test_qualifications_come_back_on_the_employees_own_record(): void
    {
        // Without this the section renders "no qualifications on file" for
        // somebody who has four.
        EmployeeEducation::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'qualification' => 'B.Tech',
        ]);

        $this->actingAs($this->employee)
            ->getJson('/api/me/employee-records')
            ->assertOk()
            ->assertJsonPath('educations.0.qualification', 'B.Tech');
    }

    public function test_an_employee_can_remove_a_qualification_they_recorded(): void
    {
        $record = EmployeeEducation::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'qualification' => 'B.Tech',
        ]);

        $this->actingAs($this->employee)
            ->deleteJson("/api/me/educations/{$record->id}")
            ->assertOk();

        $this->assertNull(EmployeeEducation::find($record->id));
    }

    public function test_an_employee_cannot_touch_another_persons_qualification(): void
    {
        $colleague = User::create([
            'name' => 'Other Person',
            'email' => 'other5@carevance.test',
            'password' => bcrypt('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);

        $theirs = EmployeeEducation::create([
            'organization_id' => $this->organization->id,
            'user_id' => $colleague->id,
            'qualification' => 'M.Sc',
        ]);

        $this->actingAs($this->employee)
            ->deleteJson("/api/me/educations/{$theirs->id}")
            ->assertNotFound();

        $this->assertNotNull(EmployeeEducation::find($theirs->id));

        // And an id in the body cannot redirect an upsert either.
        $this->actingAs($this->employee)->post('/api/me/educations', [
            'id' => $theirs->id,
            'qualification' => 'Hijacked',
        ])->assertCreated();

        $this->assertSame('M.Sc', $theirs->fresh()->qualification);
    }

    public function test_a_document_belonging_to_somebody_else_is_never_reachable(): void
    {
        $colleague = User::create([
            'name' => 'Other Person',
            'email' => 'other4@carevance.test',
            'password' => bcrypt('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);

        $this->actingAs($colleague)->post('/api/me/documents', [
            'title' => 'Their private upload',
            'category' => 'address_proof',
            'file' => UploadedFile::fake()->create('theirs.pdf', 12, 'application/pdf'),
        ])->assertCreated();

        $document = EmployeeDocument::query()->where('user_id', $colleague->id)->firstOrFail();

        $this->actingAs($this->employee)
            ->get("/api/me/documents/{$document->id}/download")
            ->assertForbidden();
    }
}
