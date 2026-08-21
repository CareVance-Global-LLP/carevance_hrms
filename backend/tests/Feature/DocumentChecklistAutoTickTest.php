<?php

namespace Tests\Feature;

use App\Models\ChecklistItem;
use App\Models\ChecklistTemplate;
use App\Models\ChecklistTemplateItem;
use App\Models\EmployeeGovernmentId;
use App\Models\OnboardingJourney;
use App\Models\Organization;
use App\Models\User;
use App\Services\Employees\EmployeeWorkspaceService;
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
}
