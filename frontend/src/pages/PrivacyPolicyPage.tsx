import LegalDocumentPage from '@/components/public/LegalDocumentPage';
import { privacyPolicySections } from '@/lib/legalContent';
import { legalProductLabel } from '@/config/brand';

export default function PrivacyPolicyPage() {
  return (
    <LegalDocumentPage
      eyebrow="Privacy policy"
      title={`Privacy expectations for ${legalProductLabel}`}
      description="This placeholder privacy copy is structured for launch preparation and legal review, while keeping the page editable and consistent with the existing marketing site design."
      lastUpdated="April 6, 2026"
      sections={privacyPolicySections}
    />
  );
}
