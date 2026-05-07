import { Link } from 'react-router-dom';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';

export default function SuperAdminCompaniesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Super Admin"
        title="Companies"
        description="Manage tenant companies and open their detail pages."
      />

      <SurfaceCard className="p-5">
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Company management page is available in this route.
          </p>
          <Link
            to="/dashboard"
            className="inline-flex h-9 items-center rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Back to Dashboard
          </Link>
        </div>
      </SurfaceCard>
    </div>
  );
}
