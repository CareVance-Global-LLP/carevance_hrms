import { invitationApi, projectApi, reportGroupApi } from '@/services/api';

export type InviteUserRole = 'employee' | 'manager' | 'admin';

export interface InviteOption {
  id: number;
  name: string;
  description: string;
  isDefault?: boolean;
}

export interface InviteDefaults {
  remember: boolean;
  groupIds: number[];
  projectIds: number[];
}

export interface AdditionalInviteSettings {
  monitoringInterval: 1 | 3 | 5 | 10 | 15 | 30;
  canEditTime: boolean;
  attendanceMonitoring: boolean;
  payrollVisibility: boolean;
  taskAssignmentAccess: boolean;
}

export interface InviteSubmissionPayload {
  organizationId: number;
  emails: string[];
  role: InviteUserRole;
  groupIds: number[];
  projectIds: number[];
  settings: AdditionalInviteSettings;
}

export interface InviteLinkPayload {
  organizationId: number;
  email: string;
  role: InviteUserRole;
  groupIds: number[];
  projectIds: number[];
  settings: AdditionalInviteSettings;
}

export interface InviteSubmissionResult {
  invitedCount: number;
  failed: Array<{ email: string; message: string }>;
  deferredAssignments: string[];
}

export interface InviteLinkResult {
  url: string;
  meta: {
    role: InviteUserRole;
    email: string;
    groupIds: number[];
    projectIds: number[];
  };
}

export interface CsvParseRow {
  email: string;
  name: string;
  role: InviteUserRole;
  groupIds: number[];
  projectIds: number[];
}

export interface CsvParseResult {
  rows: CsvParseRow[];
  errors: string[];
}

interface BulkInviteRowPayload {
  email: string;
  role: InviteUserRole;
  group_ids?: number[];
  project_ids?: number[];
}

type TabularRow = unknown[];

const INVITE_DEFAULTS_KEY = 'carevance-add-user-defaults';

const roleAliasMap: Partial<Record<string, InviteUserRole>> = {
  employee: 'employee',
  user: 'employee',
  regular: 'employee',
  regularuser: 'employee',
  'regular user': 'employee',
  manager: 'manager',
  admin: 'admin',
  administrator: 'admin',
};

const toSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const deriveDisplayName = (email: string) => {
  const localPart = email.split('@')[0] || 'User';
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
};

const parseMultiValueField = (value: string) =>
  value
    .split(/[|;]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const mapOptionNamesToIds = (values: string[], options: InviteOption[]) => {
  const optionMap = new Map(options.map((option) => [toSlug(option.name), option.id]));

  return values
    .map((value) => {
      const normalized = toSlug(value);
      const asNumber = Number(value);
      if (Number.isFinite(asNumber) && asNumber > 0) {
        return asNumber;
      }
      return optionMap.get(normalized) ?? null;
    })
    .filter((value): value is number => Boolean(value));
};

const parseCsvLine = (line: string) => {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  result.push(current.trim());
  return result;
};

const chunkItems = <T>(items: T[], chunkSize: number): T[][] => {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
};

const normalizeCell = (value: unknown) => String(value ?? '').trim();

export const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

const supportedImportExtensions = ['.csv', '.xlsx'];

const hasSupportedImportExtension = (fileName: string) =>
  supportedImportExtensions.some((extension) => fileName.toLowerCase().endsWith(extension));

export function normalizeEmails(rawValue: string) {
  const entries = rawValue
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  const valid = Array.from(new Set(entries.filter((value) => emailPattern.test(value.toLowerCase())).map((value) => value.toLowerCase())));
  const invalid = Array.from(new Set(entries.filter((value) => !emailPattern.test(value.toLowerCase()))));

  return { valid, invalid };
}

export const addUserService = {
  async fetchGroups() {
    const response = await reportGroupApi.list();
    const groups = response.data?.data || [];

    return groups.map((group) => ({
      id: group.id,
      name: group.name,
      description: `${group.users.length} member${group.users.length === 1 ? '' : 's'}`,
      isDefault: group.users.length > 0,
    })) satisfies InviteOption[];
  },

  async fetchProjects() {
    const response = await projectApi.getAll();
    const projects = response.data || [];

    return projects.map((project) => ({
      id: project.id,
      name: project.name,
      description: project.status === 'active' ? 'Active project' : `Status: ${project.status.replace('_', ' ')}`,
      isDefault: project.status === 'active',
    })) satisfies InviteOption[];
  },
  
  loadDefaults(): InviteDefaults {
    if (typeof window === 'undefined') {
      return { remember: false, groupIds: [], projectIds: [] };
    }

    try {
      const parsed = JSON.parse(window.localStorage.getItem(INVITE_DEFAULTS_KEY) || '{}') as Partial<InviteDefaults>;
      return {
        remember: Boolean(parsed.remember),
        groupIds: Array.isArray(parsed.groupIds) ? parsed.groupIds.filter((id) => Number.isFinite(id)) : [],
        projectIds: Array.isArray(parsed.projectIds) ? parsed.projectIds.filter((id) => Number.isFinite(id)) : [],
      };
    } catch {
      return { remember: false, groupIds: [], projectIds: [] };
    }
  },

  saveDefaults(defaults: InviteDefaults) {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(INVITE_DEFAULTS_KEY, JSON.stringify(defaults));
  },

  clearDefaults() {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(INVITE_DEFAULTS_KEY);
  },

  async inviteByEmail(payload: InviteSubmissionPayload): Promise<InviteSubmissionResult> {
    const response = await invitationApi.create({
      emails: payload.emails,
      role: payload.role,
      delivery: 'email',
      group_ids: payload.groupIds,
      project_ids: payload.projectIds,
      settings: {
        monitoring_interval_minutes: payload.settings.monitoringInterval,
        can_edit_time: payload.settings.canEditTime,
        attendance_monitoring: payload.settings.attendanceMonitoring,
        payroll_visibility: payload.settings.payrollVisibility,
        task_assignment_access: payload.settings.taskAssignmentAccess,
      },
    });

    const failed = response.data.failed || [];
    const deferredAssignments = payload.projectIds.length > 0
      ? ['Project IDs are stored with the invitation for future provisioning, but project-access automation is not wired yet.']
      : [];

    return {
      invitedCount: response.data.invited_count || 0,
      failed,
      deferredAssignments,
    };
  },

  async generateInviteLink(payload: InviteLinkPayload) {
    const response = await invitationApi.create({
      email: payload.email,
      role: payload.role,
      delivery: 'link',
      group_ids: payload.groupIds,
      project_ids: payload.projectIds,
      settings: {
        monitoring_interval_minutes: payload.settings.monitoringInterval,
        can_edit_time: payload.settings.canEditTime,
        attendance_monitoring: payload.settings.attendanceMonitoring,
        payroll_visibility: payload.settings.payrollVisibility,
        task_assignment_access: payload.settings.taskAssignmentAccess,
      },
    });

    const invitation = response.data.invitations[0];

    return {
      url: invitation?.invite_url || '',
      meta: {
        role: payload.role,
        email: payload.email,
        groupIds: payload.groupIds,
        projectIds: payload.projectIds,
      },
    } satisfies InviteLinkResult;
  },

  async copyInviteLink(url: string) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return;
    }

    const textArea = document.createElement('textarea');
    textArea.value = url;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    textArea.remove();
  },

  isSupportedImportFile(fileName: string) {
    return hasSupportedImportExtension(fileName);
  },

  parseTableRows(tableRows: TabularRow[], groups: InviteOption[], projects: InviteOption[]): CsvParseResult {
    const normalizedRows = tableRows
      .map((row) => row.map((cell) => normalizeCell(cell)))
      .filter((row) => row.some((cell) => cell !== ''));

    if (normalizedRows.length === 0) {
      return { rows: [], errors: ['Import file is empty.'] };
    }

    const [headerRow, ...dataRows] = normalizedRows;
    const headers = headerRow.map((header) => toSlug(header));
    const rows: CsvParseRow[] = [];
    const errors: string[] = [];

    const emailIndex = headers.indexOf('email');
    const nameIndex = headers.indexOf('name');
    const roleIndex = headers.indexOf('role');
    const groupIndex = headers.findIndex((header) => ['groups', 'group', 'group ids'].includes(header));
    const projectIndex = headers.findIndex((header) => ['projects', 'project', 'project ids'].includes(header));

    if (emailIndex < 0) {
      return { rows: [], errors: ['Import file must include an email column.'] };
    }

    dataRows.forEach((columns, index) => {
      const email = (columns[emailIndex] || '').trim().toLowerCase();
      const rawRole = (columns[roleIndex] || '').trim();
      const roleValue = toSlug(rawRole || 'employee');
      const role = roleAliasMap[roleValue];

      if (!emailPattern.test(email)) {
        errors.push(`Row ${index + 2}: invalid email "${columns[emailIndex] || ''}".`);
        return;
      }

      if (rawRole && !role) {
        errors.push(`Row ${index + 2}: unsupported role "${rawRole}". Use employee, manager, or admin.`);
        return;
      }

      rows.push({
        email,
        name: (columns[nameIndex] || '').trim() || deriveDisplayName(email),
        role: role || 'employee',
        groupIds: mapOptionNamesToIds(parseMultiValueField(columns[groupIndex] || ''), groups),
        projectIds: mapOptionNamesToIds(parseMultiValueField(columns[projectIndex] || ''), projects),
      });
    });

    return { rows, errors };
  },

  parseCsv(content: string, groups: InviteOption[], projects: InviteOption[]): CsvParseResult {
    const tableRows = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (tableRows.length === 0) {
      return { rows: [], errors: ['CSV file is empty.'] };
    }

    return this.parseTableRows(tableRows.map((line) => parseCsvLine(line)), groups, projects);
  },

  async parseImportFile(file: File, groups: InviteOption[], projects: InviteOption[]): Promise<CsvParseResult> {
    const lowerName = file.name.toLowerCase();

    if (lowerName.endsWith('.csv')) {
      const content = await file.text();
      return this.parseCsv(content, groups, projects);
    }

    if (lowerName.endsWith('.xlsx')) {
      const { default: readXlsxFile } = await import('read-excel-file/browser');
      const tableRows = await readXlsxFile(await file.arrayBuffer()) as unknown as TabularRow[];

      if (tableRows.length === 0) {
        return { rows: [], errors: ['XLSX file is empty.'] };
      }

      return this.parseTableRows(
        tableRows.map((row) => row.map((cell) => normalizeCell(cell))),
        groups,
        projects
      );
    }

    return {
      rows: [],
      errors: ['Unsupported file format. Please upload a CSV or XLSX file.'],
    };
  },

  async processImportFile(
    file: File,
    basePayload: {
      organizationId: number;
      defaultGroupIds: number[];
      defaultProjectIds: number[];
      settings: AdditionalInviteSettings;
    },
    groups: InviteOption[],
    projects: InviteOption[]
  ) {
    const parsed = await this.parseImportFile(file, groups, projects);

    if (parsed.rows.length === 0) {
      return {
        parsed,
        result: {
          invitedCount: 0,
          failed: parsed.errors.map((message) => ({ email: 'csv', message })),
          deferredAssignments: [],
        } satisfies InviteSubmissionResult,
      };
    }

    let invitedCount = 0;
    const failed = parsed.errors.map((message) => ({ email: 'csv', message }));
    const deferredAssignments = new Set<string>();
    const rows: BulkInviteRowPayload[] = parsed.rows.map((row) => ({
      email: row.email,
      role: row.role,
      group_ids: row.groupIds,
      project_ids: row.projectIds,
    }));
    const rowChunks = chunkItems<BulkInviteRowPayload>(rows, 250);

    for (const rowChunk of rowChunks) {
      try {
        const response = await invitationApi.importCsv({
          rows: rowChunk,
          default_group_ids: basePayload.defaultGroupIds,
          default_project_ids: basePayload.defaultProjectIds,
          settings: {
            monitoring_interval_minutes: basePayload.settings.monitoringInterval,
            can_edit_time: basePayload.settings.canEditTime,
            attendance_monitoring: basePayload.settings.attendanceMonitoring,
            payroll_visibility: basePayload.settings.payrollVisibility,
            task_assignment_access: basePayload.settings.taskAssignmentAccess,
          },
        });

        invitedCount += response.data.invited_count || 0;
        failed.push(...(response.data.failed || []));
      } catch (error: any) {
        const responseFailed = error?.response?.data?.failed;

        if (Array.isArray(responseFailed) && responseFailed.length > 0) {
          failed.push(...responseFailed);
          continue;
        }

        failed.push({
          email: 'csv',
          message: error?.response?.data?.message || 'Unable to import this CSV batch.',
        });
      }
    }

    if (parsed.rows.some((row) => row.projectIds.length > 0) || basePayload.defaultProjectIds.length > 0) {
      deferredAssignments.add('CSV project IDs are stored for future provisioning, but project-access automation is not wired yet.');
    }


    return {
      parsed,
      result: {
        invitedCount,
        failed,
        deferredAssignments: Array.from(deferredAssignments),
      } satisfies InviteSubmissionResult,
    };
  },
  
  downloadCsvTemplate() {
    const template = [
      'email,name,role,groups,projects',
      'alex@example.com,Alex Johnson,employee,"Operations|Night Shift","CareVance HRMS"',
      'jordan@example.com,Jordan Lee,manager,"Operations","Implementation"',
    ].join('\n');

    const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'carevance-add-user-template.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },
};
