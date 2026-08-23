import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Upload, Download, Eye, Loader2 } from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';

export default function ProofDocumentsCenter() {
  const [filterStatus, setFilterStatus] = useState<string>('');

  const { data: declarations, isLoading } = useQuery({
    queryKey: ['tax-declarations-proofs'],
    queryFn: () => payrollApi.listTaxDeclarations({}).then(r => r.data),
  });

  const declList = Array.isArray(declarations)
    ? declarations
    : (declarations as any)?.declarations ?? [];

  const allItems = declList.flatMap((d: any) =>
    (d.items || []).map((item: any) => ({
      ...item,
      financial_year: d.financial_year,
      declaration_status: d.status,
    }))
  );

  const proofItems = allItems.filter((item: any) => item.proof_path);
  const filtered = filterStatus
    ? proofItems.filter((i: any) => i.status === filterStatus)
    : proofItems;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Uploaded Proof Documents</h3>
        <div className="flex items-center gap-2">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
        </div>
      ) : filtered.length === 0 ? (
        <SurfaceCard className="p-5">
          <div className="text-center py-12">
            <Upload className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500">No proof documents uploaded yet</p>
            <p className="text-xs text-slate-500 mt-1">
              Upload proofs from Tax Declarations page
            </p>
          </div>
        </SurfaceCard>
      ) : (
        <SurfaceCard className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Section</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Description</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Amount</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">FY</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((item: any, idx: number) => (
                <tr key={item.id ?? idx} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-900">{item.section || '-'}</td>
                  <td className="px-4 py-3 text-slate-600">{item.description || '-'}</td>
                  <td className="px-4 py-3 text-slate-900">
                    ₹{Number(item.declared_amount || 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{item.financial_year || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      item.status === 'approved' ? 'bg-emerald-50 text-emerald-700' :
                      item.status === 'rejected' ? 'bg-rose-50 text-rose-700' :
                      'bg-amber-50 text-amber-700'
                    }`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        iconLeft={<Eye className="h-3 w-3" />}
                        onClick={() => window.open(item.proof_path, '_blank', 'noopener,noreferrer')}
                      >
                        View
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        iconLeft={<Download className="h-3 w-3" />}
                        onClick={() => {
                          const a = document.createElement('a');
                          a.href = item.proof_path;
                          a.download = item.proof_path.split('/').pop();
                          a.click();
                        }}
                      >
                        Download
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SurfaceCard>
      )}
    </div>
  );
}
