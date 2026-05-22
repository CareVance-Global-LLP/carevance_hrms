import { useParams } from 'react-router-dom';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';

export default function SuperAdminCompanyDetailPage() {
  const { companyId, organizationId } = useParams();
  const id = companyId || organizationId;
  const isOrganization = !!organizationId;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Super Admin"
        title={isOrganization ? "Organization Detail" : "Company Detail"}
        description={`ID: ${id || 'N/A'}`}
      />

      <SurfaceCard className="p-5">
        <p className="text-sm text-slate-600">
          {isOrganization 
            ? "Organization detail page is under development." 
            : "Company detail page is available for this tenant."}
        </p>
      </SurfaceCard>
    </div>
  );
}
