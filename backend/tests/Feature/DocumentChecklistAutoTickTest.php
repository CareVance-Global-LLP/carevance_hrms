<?php

namespace Tests\Feature;

use App\Models\ChecklistItem;
use App\Models\ChecklistTemplate;
use App\Models\ChecklistTemplateItem;
use App\Models\EmployeeBankAccount;
use App\Models\EmployeeGovernmentId;
use App\Models\OnboardingJourney;
use App\Models\Organization;
use App\Models\User;
use App\Services\Employees\EmployeeWorkspaceService;
use App\Services\Lifecycle\ChecklistEvidenceSync;
use App\Services\Lifecycle\DefaultChecklistProvisioner;
use App\Services\Lifecycle\OnboardingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * A document upload completes the checklist item that was waiting for it —
 * whichever panel the upload came from.
 *
 * Both sides matter, and they were never going to work by accident: an admin
 * uploading on somebody's behalf and the employee uploading for themselves go
 * through different controllers. The tick is hooked at
 * EmployeeWorkspaceService::storeDocument, the single funnel both use, and these
 * tests are what hold it there.
 *
 * The mapping is the real subject. The checklist asks for `pan` / `bank` /
 * `identity` / `employment`; uploads are tagged `government_id_proof` /
 * `bank_proof` / `id_proof` / `experience_document`. No value appears in both
 * lists, so an equality match would compile and never fire — and a checklist
 * item that stays pending looks exactly like one nobody has done yet.
 */
class DocumentChecklistAutoTickTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $employee;
    private User $admin;
    private OnboardingJourney $journey;
    private ChecklistTemplate $template;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('employee_documents');

        $this->organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance-autotick',
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

        $this->journey = OnboardingJourney::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'candidate_name' => 'Ava Employee',
            'candidate_email' => 'ava@carevance.test',
            'joining_date' => now()->addDays(7)->toDateString(),
            'stage' => OnboardingJourney::STAGE_PREBOARDING,
        ]);

        $this->template = ChecklistTemplate::create([
            'organization_id' => $this->organization->id,
            'kind' => 'onboarding',
            'name' => 'Test onboarding',
            'is_default' => true,
            'is_active' => true,
        ]);
    }

    /** An item on this employee's journey that waits for `$category`. */
    private function itemWanting(?string $category, string $title = 'Upload something'): ChecklistItem
    {
        $templateItem = ChecklistTemplateItem::create([
            'checklist_template_id' => $this->template->id,
            'title' => $title,
            'owner_kind' => 'employee',
            'offset_days' => -7,
            'requires' => $category === null ? 'none' : 'document',
            'document_category' => $category,
            'is_blocking' => false,
            'sort_order' => 10,
        ]);

        return ChecklistItem::create([
            'organization_id' => $this->organization->id,
            'subject_type' => $this->journey->getMorphClass(),
            'subject_id' => $this->journey->getKey(),
            'checklist_template_item_id' => $templateItem->id,
            'title' => $title,
            'owner_kind' => 'employee',
            'due_date' => now()->toDateString(),
            'requires' => $category === null ? 'none' : 'document',
            'is_blocking' => false,
            'status' => ChecklistItem::STATUS_PENDING,
            'sort_order' => 10,
        ]);
    }

    private function upload(User $actor, string $category, string $title = 'A file'): \App\Models\EmployeeDocument
    {
        return app(EmployeeWorkspaceService::class)->storeDocument(
            $this->employee,
            $actor,
            ['title' => $title, 'category' => $category],
            UploadedFile::fake()->create('file.pdf', 12, 'application/pdf')
        );
    }

    /**
     * A proof stored the way the controllers store one: the ID type travels in
     * `meta`, because the row that will link to this document does not exist
     * yet at the moment the checklist is evaluated.
     */
    private function uploadGovernmentIdProof(User $actor, string $idType): \App\Models\EmployeeDocument
    {
        return app(EmployeeWorkspaceService::class)->storeDocument(
            $this->employee,
            $actor,
            [
                'title' => $idType.' proof',
                'category' => 'government_id_proof',
                'meta' => ['id_type' => $idType],
            ],
            UploadedFile::fake()->create('proof.pdf', 12, 'application/pdf')
        );
    }

    // ------------------------------------------------------------ both sides

    public function test_an_employee_upload_ticks_the_item_that_wanted_it(): void
    {
        $item = $this->itemWanting('bank', 'Upload bank account details');

        $document = $this->upload($this->employee, 'bank_proof');

        $item->refresh();
        $this->assertSame(ChecklistItem::STATUS_DONE, $item->status);
        $this->assertSame($this->employee->id, $item->completed_by);
        // The evidence is linked, so a reviewer can open the file rather than
        // taking the tick on trust.
        $this->assertSame($document->id, $item->employee_document_id);
    }

    public function test_an_admin_upload_ticks_the_same_item(): void
    {
        // The half that would silently not work if the hook lived in the
        // employee's controller rather than the shared service.
        $item = $this->itemWanting('bank', 'Upload bank account details');

        $this->upload($this->admin, 'bank_proof');

        $item->refresh();
        $this->assertSame(ChecklistItem::STATUS_DONE, $item->status);
        $this->assertSame($this->admin->id, $item->completed_by);
    }

    // -------------------------------------------------------- the mapping

    public function test_an_experience_document_satisfies_the_employment_item(): void
    {
        $item = $this->itemWanting('employment', 'Upload previous employment documents');

        $this->upload($this->employee, 'experience_document');

        $this->assertSame(ChecklistItem::STATUS_DONE, $item->refresh()->status);
    }

    public function test_an_id_proof_satisfies_the_identity_item(): void
    {
        $item = $this->itemWanting('identity', 'Upload proof of identity and address');

        $this->upload($this->employee, 'id_proof');

        $this->assertSame(ChecklistItem::STATUS_DONE, $item->refresh()->status);
    }

    public function test_a_pan_proof_ticks_the_pan_item_and_not_the_identity_one(): void
    {
        /*
         * A government-ID proof is stored under one category whatever it proves,
         * so the ID type is what separates a PAN card from an Aadhaar. Letting a
         * PAN satisfy both items would tick two gates for one upload.
         *
         * The type has to travel ON the document. The controller stores the
         * proof and only then writes the employee_government_ids row pointing
         * back at it — so looking the type up through that link finds nothing,
         * and the PAN item could never tick while a PAN card wrongly satisfied
         * the identity item instead.
         */
        $panItem = $this->itemWanting('pan', 'Upload PAN card');
        $identityItem = $this->itemWanting('identity', 'Upload proof of identity and address');

        $this->uploadGovernmentIdProof($this->admin, 'pan');

        $this->assertSame(ChecklistItem::STATUS_DONE, $panItem->refresh()->status);
        $this->assertSame(ChecklistItem::STATUS_PENDING, $identityItem->refresh()->status);
    }

    public function test_an_aadhaar_proof_ticks_the_identity_item_and_not_the_pan_one(): void
    {
        $panItem = $this->itemWanting('pan', 'Upload PAN card');
        $identityItem = $this->itemWanting('identity', 'Upload proof of identity and address');

        $this->uploadGovernmentIdProof($this->employee, 'aadhaar');

        $this->assertSame(ChecklistItem::STATUS_PENDING, $panItem->refresh()->status);
        $this->assertSame(ChecklistItem::STATUS_DONE, $identityItem->refresh()->status);
    }

    public function test_the_id_type_is_read_from_a_linked_row_when_there_is_no_meta(): void
    {
        // The fallback path, for a document evaluated again after its government
        // ID row exists — e.g. anything written before the meta was stamped.
        $panItem = $this->itemWanting('pan', 'Upload PAN card');

        $document = $this->upload($this->admin, 'government_id_proof', 'PAN proof');
        EmployeeGovernmentId::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'id_type' => 'PAN',
            'id_number' => 'ABCPE1234F',
            'employee_document_id' => $document->id,
        ]);

        $items = app(\App\Services\Lifecycle\DocumentChecklistMatcher::class)
            ->pendingItemsFor($this->employee, $document->fresh());

        $this->assertTrue($items->contains(fn ($item) => $item->id === $panItem->id));
    }

    public function test_a_category_nothing_maps_to_ticks_nothing(): void
    {
        $item = $this->itemWanting('bank', 'Upload bank account details');

        $this->upload($this->employee, 'other');

        $this->assertSame(ChecklistItem::STATUS_PENDING, $item->refresh()->status);
    }

    public function test_the_contract_item_cannot_be_satisfied_by_any_upload(): void
    {
        /*
         * Documented rather than fixed. "Sign employment contract" is a BLOCKING
         * item and no upload path in the application produces a `contract`
         * category, so it can only ever be ticked by hand. Guessing — letting
         * `other` satisfy it, say — would release a blocking gate because
         * somebody uploaded an unrelated file.
         */
        $item = $this->itemWanting('contract', 'Sign employment contract');

        foreach (['other', 'id_proof', 'bank_proof', 'experience_document', 'government_id_proof'] as $category) {
            $this->upload($this->admin, $category);
        }

        $this->assertSame(ChecklistItem::STATUS_PENDING, $item->refresh()->status);
    }

    public function test_an_item_naming_no_category_is_never_ticked_by_an_upload(): void
    {
        // Otherwise any file would complete every open document item.
        $item = $this->itemWanting(null, 'Attend induction call');

        $this->upload($this->employee, 'bank_proof');

        $this->assertSame(ChecklistItem::STATUS_PENDING, $item->refresh()->status);
    }

    // ------------------------------------------------------------- integrity

    public function test_a_second_upload_does_not_re_complete_a_settled_item(): void
    {
        // Replacing a scan must not move the completion timestamp or rewrite who
        // satisfied it.
        $item = $this->itemWanting('bank', 'Upload bank account details');

        $this->upload($this->employee, 'bank_proof');
        $item->refresh();
        $firstCompletedAt = $item->completed_at;
        $firstCompletedBy = $item->completed_by;

        $this->upload($this->admin, 'bank_proof');
        $item->refresh();

        $this->assertEquals($firstCompletedAt, $item->completed_at);
        $this->assertSame($firstCompletedBy, $item->completed_by);
    }

    public function test_another_persons_checklist_is_never_touched(): void
    {
        $colleague = User::create([
            'name' => 'Other Person',
            'email' => 'other@carevance.test',
            'password' => bcrypt('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);

        $theirJourney = OnboardingJourney::create([
            'organization_id' => $this->organization->id,
            'user_id' => $colleague->id,
            'candidate_name' => 'Other Person',
            'candidate_email' => 'other@carevance.test',
            'joining_date' => now()->addDays(7)->toDateString(),
            'stage' => OnboardingJourney::STAGE_PREBOARDING,
        ]);

        $templateItem = ChecklistTemplateItem::create([
            'checklist_template_id' => $this->template->id,
            'title' => 'Upload bank account details',
            'owner_kind' => 'employee',
            'offset_days' => -7,
            'requires' => 'document',
            'document_category' => 'bank',
            'is_blocking' => false,
            'sort_order' => 10,
        ]);

        $theirItem = ChecklistItem::create([
            'organization_id' => $this->organization->id,
            'subject_type' => $theirJourney->getMorphClass(),
            'subject_id' => $theirJourney->getKey(),
            'checklist_template_item_id' => $templateItem->id,
            'title' => 'Upload bank account details',
            'owner_kind' => 'employee',
            'due_date' => now()->toDateString(),
            'requires' => 'document',
            'is_blocking' => false,
            'status' => ChecklistItem::STATUS_PENDING,
            'sort_order' => 10,
        ]);

        $this->upload($this->employee, 'bank_proof');

        $this->assertSame(ChecklistItem::STATUS_PENDING, $theirItem->refresh()->status);
    }

    // ------------------------------------------------ reconciled on the read

    /*
     * The other half of the problem, and the one that made ticking feel manual.
     *
     * The upload-time hook can only see documents that arrive after the item
     * exists, in a request where nothing threw. Everything else — a scan filed
     * during the add-user wizard, a journey opened after the fact, a request
     * where the tick failed and was swallowed — left the item pending next to a
     * file that plainly answered it, for ever. `ChecklistEvidenceSync` asks the
     * question the other way round, on journey open and on every read of the
     * checklist, from either panel.
     *
     * These tests reproduce the failure by uploading BEFORE the item exists,
     * which is the order the real cases occur in.
     */

    public function test_a_document_already_on_file_ticks_when_the_joiner_opens_their_dashboard(): void
    {
        $document = $this->upload($this->employee, 'bank_proof', 'Cancelled cheque');

        // The item did not exist when the file landed, so nothing ticked it.
        $item = $this->itemWanting('bank', 'Upload bank account details');
        $this->assertSame(ChecklistItem::STATUS_PENDING, $item->status);

        $this->actingAs($this->employee)
            ->getJson('/api/onboarding/my-journey')
            ->assertSuccessful();

        $item->refresh();
        $this->assertSame(ChecklistItem::STATUS_DONE, $item->status);
        $this->assertSame($document->id, $item->employee_document_id);
    }

    public function test_the_admin_reading_the_journey_sees_the_same_tick(): void
    {
        $document = $this->upload($this->employee, 'id_proof', 'Aadhaar card');
        $item = $this->itemWanting('identity', 'Upload proof of identity and address');

        $response = $this->actingAs($this->admin)
            ->getJson('/api/onboarding/journeys/' . $this->journey->id)
            ->assertSuccessful();

        $this->assertSame(ChecklistItem::STATUS_DONE, $item->refresh()->status);

        // And the response carries the evidence, so the panel can name the file
        // rather than showing a tick nobody can account for.
        $payload = collect($response->json('data.checklist_items'))
            ->firstWhere('id', $item->id);

        $this->assertSame('done', $payload['status']);
        $this->assertSame($document->id, $payload['document']['id']);
        $this->assertSame('Aadhaar card', $payload['document']['title']);
    }

    public function test_the_new_hires_list_reconciles_the_rows_it_renders(): void
    {
        $this->upload($this->employee, 'bank_proof');
        $item = $this->itemWanting('bank', 'Upload bank account details');

        $response = $this->actingAs($this->admin)
            ->getJson('/api/onboarding/journeys')
            ->assertSuccessful();

        $this->assertSame(ChecklistItem::STATUS_DONE, $item->refresh()->status);

        // The readiness ring on the list has to agree with the panel that opens
        // from it; a row reading "1 outstanding" over a done item is the bug.
        $row = collect($response->json('data'))->firstWhere('id', $this->journey->id);
        $this->assertSame($row['readiness']['total'], $row['readiness']['done']);
    }

    public function test_the_tick_is_stamped_with_the_uploads_own_time_and_uploader(): void
    {
        // A scan filed in June, noticed by a sync in August. Stamping `now()`
        // and the reader would record "completed today by the admin who
        // happened to open New Hires" for something done months earlier.
        $document = $this->upload($this->admin, 'bank_proof');
        $document->forceFill(['uploaded_at' => now()->subMonths(2)])->save();

        $item = $this->itemWanting('bank', 'Upload bank account details');

        $this->actingAs($this->employee)
            ->getJson('/api/onboarding/my-journey')
            ->assertSuccessful();

        $item->refresh();
        $this->assertSame($this->admin->id, $item->completed_by);
        $this->assertTrue($document->fresh()->uploaded_at->equalTo($item->completed_at));
    }

    public function test_reading_the_checklist_twice_does_not_move_the_completion(): void
    {
        $this->upload($this->employee, 'bank_proof');
        $item = $this->itemWanting('bank', 'Upload bank account details');

        $this->actingAs($this->employee)->getJson('/api/onboarding/my-journey')->assertSuccessful();
        $first = $item->refresh()->completed_at;

        $this->actingAs($this->admin)
            ->getJson('/api/onboarding/journeys/' . $this->journey->id)
            ->assertSuccessful();
        $item->refresh();

        $this->assertEquals($first, $item->completed_at);
        $this->assertSame($this->employee->id, $item->completed_by);
    }

    public function test_one_pan_card_does_not_clear_both_gates_on_a_sync(): void
    {
        $this->uploadGovernmentIdProof($this->employee, 'pan');

        $pan = $this->itemWanting('pan', 'Upload PAN card');
        $identity = $this->itemWanting('identity', 'Upload proof of identity and address');

        $this->actingAs($this->employee)->getJson('/api/onboarding/my-journey')->assertSuccessful();

        $this->assertSame(ChecklistItem::STATUS_DONE, $pan->refresh()->status);
        $this->assertSame(ChecklistItem::STATUS_PENDING, $identity->refresh()->status);
    }

    public function test_two_items_wanting_the_same_category_are_not_answered_by_one_file(): void
    {
        // "We hold two documents" is what two such items assert. One upload
        // satisfying both would be a false statement about the record.
        $this->upload($this->employee, 'bank_proof');

        $first = $this->itemWanting('bank', 'Upload bank account details');
        $second = $this->itemWanting('bank', 'Upload a second payout account');

        $this->actingAs($this->employee)->getJson('/api/onboarding/my-journey')->assertSuccessful();

        $settled = collect([$first, $second])
            ->filter(fn (ChecklistItem $item) => $item->refresh()->status === ChecklistItem::STATUS_DONE);

        $this->assertCount(1, $settled);
    }

    public function test_the_contract_item_survives_every_category_a_sync_can_see(): void
    {
        $item = $this->itemWanting('contract', 'Sign employment contract');

        foreach (['other', 'id_proof', 'bank_proof', 'experience_document', 'education_certificate'] as $category) {
            $this->upload($this->employee, $category);
        }
        $this->uploadGovernmentIdProof($this->employee, 'pan');

        $this->actingAs($this->employee)->getJson('/api/onboarding/my-journey')->assertSuccessful();

        // No upload path produces a `contract` document, and guessing at one
        // would clear a blocking gate because somebody filed an unrelated file.
        $this->assertSame(ChecklistItem::STATUS_PENDING, $item->refresh()->status);
    }

    public function test_a_journey_with_no_account_bound_syncs_nothing_and_does_not_error(): void
    {
        $preboarding = OnboardingJourney::create([
            'organization_id' => $this->organization->id,
            'user_id' => null,
            'candidate_name' => 'Not Yet Hired',
            'candidate_email' => 'pending@carevance.test',
            'joining_date' => now()->addDays(14)->toDateString(),
            'stage' => OnboardingJourney::STAGE_PREBOARDING,
        ]);

        $this->assertSame(0, app(ChecklistEvidenceSync::class)->sync($preboarding));

        $this->actingAs($this->admin)
            ->getJson('/api/onboarding/journeys/' . $preboarding->id)
            ->assertSuccessful();
    }

    public function test_opening_a_journey_picks_up_documents_filed_before_it_existed(): void
    {
        // The add-user wizard and the CSV import both upload before the journey
        // is opened, so the hook at upload time has no checklist to tick.
        $joiner = User::create([
            'name' => 'Late Journey',
            'email' => 'late@carevance.test',
            'password' => bcrypt('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);

        ChecklistTemplateItem::create([
            'checklist_template_id' => $this->template->id,
            'title' => 'Upload bank account details',
            'owner_kind' => 'employee',
            'offset_days' => -7,
            'requires' => 'document',
            'document_category' => 'bank',
            'is_blocking' => true,
            'sort_order' => 20,
        ]);

        app(EmployeeWorkspaceService::class)->storeDocument(
            $joiner,
            $this->admin,
            ['title' => 'Cancelled cheque', 'category' => 'bank_proof'],
            UploadedFile::fake()->create('cheque.pdf', 12, 'application/pdf')
        );

        $journey = app(OnboardingService::class)->ensureForUser($joiner, $this->admin);

        $item = ChecklistItem::forSubject($journey)
            ->where('title', 'Upload bank account details')
            ->firstOrFail();

        $this->assertSame(ChecklistItem::STATUS_DONE, $item->status);
    }

    // --------------------------------------------- satisfied by the record

    /*
     * The half that was wrong, and the live data is what proved it.
     *
     * Four of eight open journeys carried a PAN, an Aadhaar and a bank account
     * with `employee_document_id = NULL` — the details typed in, no scan ever
     * attached. Requiring a file meant their blocking items could never clear,
     * so the slide-over displayed the PAN in its profile panel and "not done"
     * in its checklist directly underneath.
     *
     * A document is still the stronger evidence and still wins where both
     * exist. These cover the weaker question: is the fact on the record?
     */

    private function recordGovernmentId(string $idType, string $number): EmployeeGovernmentId
    {
        return EmployeeGovernmentId::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'id_type' => $idType,
            'id_number' => $number,
            'status' => 'pending',
        ]);
    }

    private function recordBankAccount(string $ifsc = 'SBIN0001234', string $number = '30012345678'): EmployeeBankAccount
    {
        return EmployeeBankAccount::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'bank_name' => 'State Bank of India',
            'account_number' => $number,
            'ifsc_swift' => $ifsc,
            'is_default' => true,
        ]);
    }

    public function test_a_recorded_pan_completes_the_pan_item_with_no_file_at_all(): void
    {
        $item = $this->itemWanting('pan', 'Add PAN details');
        $this->recordGovernmentId('PAN', 'ABCDE1234F');

        $this->actingAs($this->employee)->getJson('/api/onboarding/my-journey')->assertSuccessful();

        $item->refresh();
        $this->assertSame(ChecklistItem::STATUS_DONE, $item->status);
        $this->assertSame('record', $item->evidence_kind);
        $this->assertSame('PAN record', $item->evidence_label);
        // No document was involved, so nothing should claim one was.
        $this->assertNull($item->employee_document_id);
    }

    public function test_a_recorded_aadhaar_completes_identity_and_a_pan_does_not(): void
    {
        $identity = $this->itemWanting('identity', 'Add proof of identity and address');
        $pan = $this->itemWanting('pan', 'Add PAN details');

        $this->recordGovernmentId('AADHAAR', '123456789012');

        $this->actingAs($this->employee)->getJson('/api/onboarding/my-journey')->assertSuccessful();

        $this->assertSame(ChecklistItem::STATUS_DONE, $identity->refresh()->status);
        $this->assertSame('Aadhaar record', $identity->evidence_label);

        // A tax number is not proof of address. It has an item of its own.
        $this->assertSame(ChecklistItem::STATUS_PENDING, $pan->refresh()->status);
    }

    public function test_a_recorded_pan_does_not_clear_the_identity_item(): void
    {
        $identity = $this->itemWanting('identity', 'Add proof of identity and address');
        $this->recordGovernmentId('PAN', 'ABCDE1234F');

        $this->actingAs($this->employee)->getJson('/api/onboarding/my-journey')->assertSuccessful();

        $this->assertSame(ChecklistItem::STATUS_PENDING, $identity->refresh()->status);
    }

    public function test_a_payable_bank_account_completes_the_bank_item(): void
    {
        $item = $this->itemWanting('bank', 'Add bank account details');
        $this->recordBankAccount();

        $this->actingAs($this->employee)->getJson('/api/onboarding/my-journey')->assertSuccessful();

        $item->refresh();
        $this->assertSame(ChecklistItem::STATUS_DONE, $item->status);
        // Named, and masked: the panel says which account, not the number.
        $this->assertStringContainsString('State Bank of India', (string) $item->evidence_label);
        $this->assertStringNotContainsString('30012345678', (string) $item->evidence_label);
    }

    public function test_a_bank_account_a_bank_would_reject_does_not_complete_the_item(): void
    {
        // A malformed IFSC is not refused by us — it is refused by the bank,
        // after the batch has gone out. Ticking the item would tell HR the
        // details were fine.
        $item = $this->itemWanting('bank', 'Add bank account details');
        $this->recordBankAccount('NOTANIFSC');

        $this->actingAs($this->employee)->getJson('/api/onboarding/my-journey')->assertSuccessful();

        $this->assertSame(ChecklistItem::STATUS_PENDING, $item->refresh()->status);
    }

    public function test_a_bank_account_with_no_number_does_not_complete_the_item(): void
    {
        $item = $this->itemWanting('bank', 'Add bank account details');
        $this->recordBankAccount('SBIN0001234', '');

        $this->actingAs($this->employee)->getJson('/api/onboarding/my-journey')->assertSuccessful();

        $this->assertSame(ChecklistItem::STATUS_PENDING, $item->refresh()->status);
    }

    public function test_a_document_wins_when_both_a_file_and_a_record_exist(): void
    {
        // The stronger evidence should be the evidence named. An item that
        // could point at the scan ought to point at the scan.
        $item = $this->itemWanting('bank', 'Add bank account details');
        $this->recordBankAccount();
        $document = $this->upload($this->employee, 'bank_proof', 'Cancelled cheque');

        $item->refresh();
        $this->assertSame(ChecklistItem::STATUS_DONE, $item->status);
        $this->assertSame('document', $item->evidence_kind);
        $this->assertSame($document->id, $item->employee_document_id);
        $this->assertSame('Cancelled cheque', $item->evidence_label);
    }

    public function test_records_never_satisfy_the_employment_or_contract_items(): void
    {
        // Neither asks about a fact. Both ask for the document itself, and
        // completing them from anything else asserts something nobody said.
        $employment = $this->itemWanting('employment', 'Upload previous employment documents');
        $contract = $this->itemWanting('contract', 'Sign employment contract');

        $this->recordGovernmentId('PAN', 'ABCDE1234F');
        $this->recordGovernmentId('AADHAAR', '123456789012');
        $this->recordBankAccount();

        $this->actingAs($this->employee)->getJson('/api/onboarding/my-journey')->assertSuccessful();

        $this->assertSame(ChecklistItem::STATUS_PENDING, $employment->refresh()->status);
        $this->assertSame(ChecklistItem::STATUS_PENDING, $contract->refresh()->status);
    }

    public function test_the_record_tick_is_stamped_with_the_records_own_time(): void
    {
        $item = $this->itemWanting('pan', 'Add PAN details');
        $record = $this->recordGovernmentId('PAN', 'ABCDE1234F');
        $record->forceFill(['created_at' => now()->subMonths(3)])->save();

        $this->actingAs($this->admin)
            ->getJson('/api/onboarding/journeys/'.$this->journey->id)
            ->assertSuccessful();

        $item->refresh();
        // The joiner declared it, not the admin who opened the page.
        $this->assertSame($this->employee->id, $item->completed_by);
        $this->assertTrue($record->fresh()->created_at->equalTo($item->completed_at));
    }

    public function test_a_second_read_does_not_move_a_record_completion(): void
    {
        $item = $this->itemWanting('pan', 'Add PAN details');
        $this->recordGovernmentId('PAN', 'ABCDE1234F');

        $this->actingAs($this->employee)->getJson('/api/onboarding/my-journey')->assertSuccessful();
        $first = $item->refresh()->completed_at;

        $this->actingAs($this->admin)
            ->getJson('/api/onboarding/journeys/'.$this->journey->id)
            ->assertSuccessful();

        $this->assertEquals($first, $item->refresh()->completed_at);
    }

    public function test_reopening_clears_the_evidence_it_was_completed_from(): void
    {
        // A reopened item still reading "From PAN record" would assert that
        // evidence closed something that is open.
        $item = $this->itemWanting('pan', 'Add PAN details');
        $this->recordGovernmentId('PAN', 'ABCDE1234F');

        $this->actingAs($this->employee)->getJson('/api/onboarding/my-journey')->assertSuccessful();
        $this->assertSame('record', $item->refresh()->evidence_kind);

        $this->actingAs($this->admin)
            ->postJson('/api/onboarding/journeys/'.$this->journey->id.'/items/'.$item->id.'/reopen')
            ->assertSuccessful();

        $item->refresh();
        $this->assertSame(ChecklistItem::STATUS_PENDING, $item->status);
        $this->assertNull($item->evidence_kind);
        $this->assertNull($item->evidence_label);
    }

    public function test_a_manual_tick_records_no_evidence(): void
    {
        // The three cases have to stay distinguishable. "Somebody clicked this"
        // must not look like "the evidence cleared it".
        $item = $this->itemWanting('contract', 'Sign employment contract');

        $this->actingAs($this->employee)
            ->postJson('/api/onboarding/journeys/'.$this->journey->id.'/items/'.$item->id.'/complete')
            ->assertSuccessful();

        $item->refresh();
        $this->assertSame(ChecklistItem::STATUS_DONE, $item->status);
        $this->assertNull($item->evidence_kind);
        $this->assertNull($item->employee_document_id);
    }

    public function test_the_default_checklist_items_are_titled_for_what_satisfies_them(): void
    {
        // Once a typed PAN completes it, "Upload PAN card" is a false statement
        // about what happened.
        $titles = collect(DefaultChecklistProvisioner::ONBOARDING)->pluck('title');

        $this->assertContains('Add PAN details', $titles);
        $this->assertContains('Add bank account details', $titles);
        $this->assertContains('Add proof of identity and address', $titles);

        // These two still require the document, so they still say so.
        $this->assertContains('Upload previous employment documents', $titles);
        $this->assertContains('Sign employment contract', $titles);
    }

    // ------------------------------------- the hand-tick is withdrawn

    /*
     * An item evidence can satisfy is not tickable by anybody.
     *
     * Four such ticks existed on the live database, across three people who had
     * no PAN, no bank account and no document of any kind. "Add PAN details ✓"
     * against a record with no PAN is not a status, it is a false statement,
     * and the first thing to disagree with it would have been payroll.
     *
     * Enforced on the API rather than only by hiding the checkbox: a control
     * the endpoint still honours is a suggestion, not a rule.
     */

    private function completeAs(User $actor, ChecklistItem $item): \Illuminate\Testing\TestResponse
    {
        return $this->actingAs($actor)
            ->postJson('/api/onboarding/journeys/'.$this->journey->id.'/items/'.$item->id.'/complete');
    }

    public function test_an_admin_cannot_hand_tick_an_item_evidence_can_satisfy(): void
    {
        $item = $this->itemWanting('pan', 'Add PAN details');

        $this->completeAs($this->admin, $item)->assertStatus(422);

        $this->assertSame(ChecklistItem::STATUS_PENDING, $item->refresh()->status);
    }

    public function test_the_joiner_cannot_hand_tick_their_own_evidence_item_either(): void
    {
        // The person who was asked for the PAN ticking it without the PAN is
        // the least useful record in the system.
        $item = $this->itemWanting('bank', 'Add bank account details');

        $this->completeAs($this->employee, $item)->assertStatus(422);

        $this->assertSame(ChecklistItem::STATUS_PENDING, $item->refresh()->status);
    }

    public function test_the_refusal_says_what_to_do_instead(): void
    {
        $item = $this->itemWanting('identity', 'Add proof of identity and address');

        $response = $this->completeAs($this->admin, $item)->assertStatus(422);

        $this->assertStringContainsString('Upload', (string) $response->json('message'));
    }

    public function test_the_contract_item_is_still_hand_tickable(): void
    {
        // No upload path produces a contract document and no recorded fact
        // stands in for a signature, so a human attesting is the only mechanism
        // it has. Withdrawing the tick here would make it impossible.
        $item = $this->itemWanting('contract', 'Sign employment contract');

        $this->completeAs($this->admin, $item)->assertSuccessful();

        $this->assertSame(ChecklistItem::STATUS_DONE, $item->refresh()->status);
    }

    public function test_an_acknowledgement_item_is_still_hand_tickable(): void
    {
        $item = $this->itemWanting(null, 'Complete workplace policy training');

        $this->completeAs($this->employee, $item)->assertSuccessful();

        $this->assertSame(ChecklistItem::STATUS_DONE, $item->refresh()->status);
    }

    public function test_an_evidence_item_still_completes_itself_from_an_upload(): void
    {
        // The rule withdraws the tick, not the completion. Refusing both would
        // leave a blocking gate nothing could ever clear.
        $item = $this->itemWanting('bank', 'Add bank account details');

        $this->completeAs($this->admin, $item)->assertStatus(422);
        $this->upload($this->employee, 'bank_proof', 'Cancelled cheque');

        $item->refresh();
        $this->assertSame(ChecklistItem::STATUS_DONE, $item->status);
        $this->assertSame('Cancelled cheque', $item->evidence_label);
    }
}
