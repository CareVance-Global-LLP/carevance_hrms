import LegalDocumentPage from '@/components/public/LegalDocumentPage';
import { termsAndConditionsSections } from '@/lib/legalContent';
import { legalProductLabel } from '@/config/brand';

export default function TermsPage() {
  return (
    <LegalDocumentPage
      eyebrow="Terms & conditions"
      title={`Usage terms for ${legalProductLabel}`}
      description="These placeholder terms are included for pre-launch readiness so legal, support, and billing language can be reviewed in-context before production rollout."
      lastUpdated="April 6, 2026"
      sections={termsAndConditionsSections}
    />
  );
}
