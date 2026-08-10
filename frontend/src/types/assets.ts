export type AssetStatus = 'available' | 'assigned';

export interface AssetAssignedTo {
  assignment_id: number;
  user_id: number;
  name: string;
  email: string | null;
  assigned_date: string | null;
}

export interface Asset {
  id: number;
  asset_tag: string;
  name: string;
  category: string;
  serial_number: string | null;
  status: AssetStatus;
  purchase_date: string | null;
  created_at: string | null;
  assigned_to: AssetAssignedTo | null;
}

export interface AssetAssignmentHistoryItem {
  id: number;
  user: { id: number; name: string; email: string | null } | null;
  assigned_by: { id: number; name: string } | null;
  assigned_date: string | null;
  returned_date: string | null;
  is_active: boolean;
}

export interface AssetDetail extends Asset {
  history: AssetAssignmentHistoryItem[];
}

export interface EmployeeAssetItem {
  assignment_id: number;
  asset_id: number;
  asset_tag: string;
  name: string;
  category: string;
  assigned_date: string | null;
}

export interface AssetFilters {
  status?: AssetStatus | '';
  category?: string;
  search?: string;
  page?: number;
  per_page?: number;
}

export interface AssetListMeta {
  current_page: number;
  per_page: number;
  total: number;
  last_page: number;
}

export interface AssetListResponse {
  data: Asset[];
  /** Every category the organization owns, not just those in the current page. */
  categories: string[];
  meta: AssetListMeta;
}

export interface CreateAssetPayload {
  asset_tag: string;
  name: string;
  category: string;
  serial_number?: string | null;
  purchase_date?: string | null;
}

export type UpdateAssetPayload = Partial<CreateAssetPayload>;
