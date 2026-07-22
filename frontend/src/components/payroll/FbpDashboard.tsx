import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Gift, Plus, X } from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';

export default function FbpDashboard() {
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [showAllocate, setShowAllocate] = useState(false);
  const [allocateData, setAllocateData] = useState({ component_id: 0, amount: 0 });

  const { data: components } = useQuery({
    queryKey: ['fbp-components'],
    queryFn: () => payrollApi.getFbpComponents().then(r => r.data),
  });

  const { data: allocations } = useQuery({
    queryKey: ['fbp-allocations', selectedUserId],
    queryFn: () => payrollApi.getFbpAllocations(selectedUserId!).then(r => r.data),
    enabled: !!selectedUserId,
  });

  const allocateMutation = useMutation({
    mutationFn: (data: { user_id: number; fbp_component_id: number; amount: number }) =>
      payrollApi.allocateFbp(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fbp-allocations'] });
      setShowAllocate(false);
    },
  });

  const compList = Array.isArray(components) ? components : (components as any)?.components ?? [];
  const allocList = Array.isArray(allocations) ? allocations : (allocations as any)?.allocations ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TextInput
            type="number"
            placeholder="Employee User ID"
            value={selectedUserId ?? ''}
            onChange={(e: any) => setSelectedUserId(Number(e.target.value) || null)}
            className="max-w-40"
          />
          <Button
            variant="primary"
            size="sm"
            iconLeft={<Plus className="h-4 w-4" />}
            disabled={!selectedUserId}
            onClick={() => setShowAllocate(true)}
          >
            Allocate
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SurfaceCard className="p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">FBP Components</h3>
          <div className="space-y-2">
            {compList.map((comp: any) => (
              <div key={comp.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                    <Gift className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-slate-900">{comp.name}</div>
                    <div className="text-xs text-slate-500">{comp.category}</div>
                  </div>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <div>Max: {comp.max_exempt_limit ? `₹${Number(comp.max_exempt_limit).toLocaleString()}` : 'No limit'}</div>
                  <div>{comp.requires_proof ? 'Proof required' : 'No proof needed'}</div>
                </div>
              </div>
            ))}
            {compList.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-6">No components configured</p>
            )}
          </div>
        </SurfaceCard>

        <SurfaceCard className="p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">
            Allocations {selectedUserId ? `— User #${selectedUserId}` : ''}
          </h3>
          {selectedUserId ? (
            <div className="space-y-2">
              {allocList.map((alloc: any) => (
                <div key={alloc.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                  <div>
                    <div className="text-sm font-medium text-slate-900">
                      {alloc.component?.name ?? `Component #${alloc.fbp_component_id}`}
                    </div>
                    <div className="text-xs text-slate-500">Status: {alloc.status}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-blue-600">
                      ₹{Number(alloc.allocated_amount ?? 0).toLocaleString()}
                    </div>
                    <div className="text-xs text-slate-500">
                      Used: ₹{Number(alloc.utilized_amount ?? 0).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
              {allocList.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-6">No allocations yet</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-500 text-center py-6">Enter a User ID to view allocations</p>
          )}
        </SurfaceCard>
      </div>

      {showAllocate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <SurfaceCard className="p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-900">Allocate FBP Component</h3>
              <button onClick={() => setShowAllocate(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Component</label>
                <select
                  value={allocateData.component_id}
                  onChange={(e) => setAllocateData(prev => ({ ...prev, component_id: Number(e.target.value) }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value={0}>Select component...</option>
                  {compList.map((comp: any) => (
                    <option key={comp.id} value={comp.id}>{comp.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Annual Allocation (₹)</label>
                <input
                  type="number"
                  value={allocateData.amount}
                  onChange={(e) => setAllocateData(prev => ({ ...prev, amount: Number(e.target.value) }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  min={0}
                />
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <Button variant="secondary" size="sm" onClick={() => setShowAllocate(false)}>Cancel</Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!allocateData.component_id || allocateMutation.isPending}
                  onClick={() => allocateMutation.mutate({
                    user_id: selectedUserId!,
                    fbp_component_id: allocateData.component_id,
                    amount: allocateData.amount,
                  })}
                >
                  {allocateMutation.isPending ? 'Allocating...' : 'Allocate'}
                </Button>
              </div>
            </div>
          </SurfaceCard>
        </div>
      )}
    </div>
  );
}
