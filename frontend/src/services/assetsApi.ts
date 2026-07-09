import api from '@/services/api';
import type {
  Asset,
  AssetDetail,
  AssetFilters,
  CreateAssetPayload,
  EmployeeAssetItem,
  UpdateAssetPayload,
} from '@/types/assets';

const buildParams = (filters?: AssetFilters): Record<string, string> => {
  const params: Record<string, string> = {};
  if (filters?.status) params.status = filters.status;
  if (filters?.category) params.category = filters.category;
  if (filters?.search && filters.search.trim()) params.search = filters.search.trim();
  return params;
};

export const assetsApi = {
  list: (filters?: AssetFilters) =>
    api.get<{ data: Asset[] }>('/assets', { params: buildParams(filters) }),

  get: (id: number) =>
    api.get<{ data: AssetDetail }>(`/assets/${id}`),

  create: (payload: CreateAssetPayload) =>
    api.post<{ data: Asset }>('/assets', payload),

  update: (id: number, payload: UpdateAssetPayload) =>
    api.put<{ data: Asset }>(`/assets/${id}`, payload),

  remove: (id: number) =>
    api.delete<{ message: string }>(`/assets/${id}`),

  assign: (id: number, userId: number, assignedDate?: string) =>
    api.post<{ message: string }>(`/assets/${id}/assign`, {
      user_id: userId,
      ...(assignedDate ? { assigned_date: assignedDate } : {}),
    }),

  return: (id: number, returnedDate?: string) =>
    api.post<{ message: string }>(`/assets/${id}/return`, {
      ...(returnedDate ? { returned_date: returnedDate } : {}),
    }),

  employeeAssets: (employeeId: number) =>
    api.get<{ data: EmployeeAssetItem[] }>(`/employees/${employeeId}/assets`),
};

export default assetsApi;
