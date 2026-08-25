import type { ChecklistItem } from '@/services/api';

/**
 * What an upload against each checklist category must be tagged as.
 *
 * The inverse of the backend's SATISFIED_BY table, and it has to stay in step
 * with it: a file posted under a category the matcher does not recognise is
 * stored, tagged, and satisfies nothing — which looks exactly like the upload
 * having failed.
 *
 * `contract` is absent, deliberately, and matches the backend. No upload path
 * produces that category and no recorded fact stands in for a signed contract,
 * so offering a control would promise something the item cannot honour.
 */
export const UPLOAD_FOR_CATEGORY: Record<string, { category: string; idType?: string }> = {
  pan: { category: 'government_id_proof', idType: 'pan' },
  identity: { category: 'id_proof' },
  bank: { category: 'bank_proof' },
  employment: { category: 'experience_document' },
  education: { category: 'education_certificate' },
};

/**
 * Can evidence complete this item on its own? Then nobody hand-ticks it.
 *
 * Mirrors `ChecklistEvidenceSync::EVIDENCE_CATEGORIES`. The API refuses these
 * with a 422 regardless — this only stops a user being offered a control that
 * would fail. A hand-ticked "Add PAN details" asserts a PAN is on file, and
 * that assertion is the one thing payroll cannot check against.
 */
export const isEvidenceBacked = (item: ChecklistItem) =>
  item.requires === 'document' &&
  !!item.checklist_template_item?.document_category &&
  item.checklist_template_item.document_category in UPLOAD_FOR_CATEGORY;
