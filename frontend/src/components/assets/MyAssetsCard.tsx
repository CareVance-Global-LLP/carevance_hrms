import { useQuery } from '@tanstack/react-query';
import { assetsApi } from '@/services/assetsApi';

const formatDate = (value: string | null): string => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

interface MyAssetsCardProps {
  userId?: number | null;
}

export default function MyAssetsCard({ userId }: MyAssetsCardProps) {
  const assetsQuery = useQuery({
    queryKey: ['employee-assets', userId],
    queryFn: async () => (await assetsApi.employeeAssets(userId as number)).data.data,
    enabled: Boolean(userId),
  });

  const assets = assetsQuery.data ?? [];

  return (
    <div>
      {assetsQuery.isLoading ? (
        <p className="text-sm text-slate-500">Loading your assets...</p>
      ) : assetsQuery.isError ? (
        <p className="text-sm text-rose-600">Could not load your assets. Please try again later.</p>
      ) : assets.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-sm text-slate-500">No assets are currently assigned to you.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                <th className="py-2 pr-4">Tag</th>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Category</th>
                <th className="py-2 pr-4">Assigned Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {assets.map((item) => (
                <tr key={item.assignment_id}>
                  <td className="py-2.5 pr-4 font-medium text-slate-900">{item.asset_tag}</td>
                  <td className="py-2.5 pr-4 text-slate-700">{item.name}</td>
                  <td className="py-2.5 pr-4 capitalize text-slate-600">{item.category}</td>
                  <td className="py-2.5 pr-4 text-slate-600">{formatDate(item.assigned_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
