<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The shared checklist engine.
 *
 * Onboarding and offboarding are the same machine pointed in opposite
 * directions: a list of owned, dated tasks generated from a template against
 * an anchor date. Giving each its own tables would mean two of every query,
 * two completion rules and two ways for them to drift apart, so `checklist_items`
 * is polymorphic over the journey it belongs to.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('checklist_templates', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->enum('kind', ['onboarding', 'offboarding']);
            $table->string('name');
            $table->text('description')->nullable();
            $table->boolean('is_default')->default(false);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['organization_id', 'kind', 'is_active']);
        });

        Schema::create('checklist_template_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('checklist_template_id')->constrained('checklist_templates')->cascadeOnDelete();
            $table->string('title');
            $table->text('description')->nullable();

            // Who is responsible. Resolved to a concrete user at materialisation
            // time, because the manager of a journey is not known until it exists.
            $table->enum('owner_kind', ['hr', 'manager', 'employee', 'it', 'finance', 'buddy']);

            // Signed, relative to the journey's anchor date. -7 means "a week
            // before joining"; +30 means "a month after the last working day".
            $table->integer('offset_days')->default(0);

            $table->enum('requires', ['none', 'document', 'asset_return', 'acknowledgement'])->default('none');
            $table->string('document_category')->nullable();

            // A blocking item stops the journey advancing. On an exit this is
            // what prevents settlement while equipment is still out.
            $table->boolean('is_blocking')->default(false);
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();

            $table->index(['checklist_template_id', 'sort_order']);
        });

        Schema::create('checklist_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();

            // Polymorphic over onboarding_journeys / employee_exits.
            $table->string('subject_type');
            $table->unsignedBigInteger('subject_id');

            $table->foreignId('checklist_template_item_id')->nullable()
                ->constrained('checklist_template_items')->nullOnDelete();

            $table->string('title');
            $table->text('description')->nullable();
            $table->enum('owner_kind', ['hr', 'manager', 'employee', 'it', 'finance', 'buddy']);
            $table->foreignId('owner_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->date('due_date')->nullable();

            $table->enum('requires', ['none', 'document', 'asset_return', 'acknowledgement'])->default('none');
            $table->boolean('is_blocking')->default(false);

            $table->enum('status', ['pending', 'done', 'blocked', 'skipped'])->default('pending');
            $table->timestamp('completed_at')->nullable();
            $table->foreignId('completed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('notes')->nullable();

            // Evidence. A document upload or an asset coming back is what
            // actually satisfies the item; the tick is a consequence, not the fact.
            $table->foreignId('employee_document_id')->nullable()
                ->constrained('employee_documents')->nullOnDelete();
            $table->foreignId('asset_assignment_id')->nullable()
                ->constrained('asset_assignments')->nullOnDelete();

            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();

            $table->index(['subject_type', 'subject_id', 'status'], 'checklist_items_subject_status_idx');
            $table->index(['organization_id', 'status', 'due_date'], 'checklist_items_org_due_idx');
            $table->index(['owner_user_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('checklist_items');
        Schema::dropIfExists('checklist_template_items');
        Schema::dropIfExists('checklist_templates');
    }
};
