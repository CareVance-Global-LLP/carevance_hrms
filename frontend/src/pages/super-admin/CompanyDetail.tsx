import { useParams } from 'react-router-dom';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';

export default function SuperAdminCompanyDetailPage() {
  const { companyId } = useParams();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Super Admin"
        title="Company Detail"
        description={`Company ID: ${companyId || 'N/A'}`}
      />

      <SurfaceCard className="p-5">
        <p className="text-sm text-slate-600">Company detail page is available for this tenant.</p>
      </SurfaceCard>
    </div>
  );
}
