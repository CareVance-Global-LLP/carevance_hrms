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
  /** null = inherit the organization default. */
  monitoringInterval: 1 | 3 | 5 | 10 | 15 | 30 | null;
  canEditTime: boolean;
  attendanceMonitoring: boolean;
  payrollVisibility: boolean;
  taskAssignmentAccess: boolean;
  timezone?: string;
}

/** Matches `emails` max:50 on StoreInvitationRequest. */
export const EMAIL_BATCH_LIMIT = 50;

export interface InviteSubmissionPayload {
  organizationId: number;
  emails: string[];
  /** Role for anyone without an entry in `roleByEmail`. */
  role: InviteUserRole;
  /**
   * Per-recipient role overrides, keyed by lower-cased email.
   *
   * The API takes one `role` per request (StoreInvitationRequest), so mixed
   * roles cannot go in a single call. Omit this and behaviour is unchanged.
   */
  roleByEmail?: Record<string, InviteUserRole>;
  /**
   * An admin-defined role applied to the whole batch.
   *
   * The server resolves the matching base role from it and ignores `role` when
   * this is set, so the two can never disagree — and a client cannot pair a
   * low-privilege custom role with `role: 'admin'`.
   */
  roleId?: number | null;
  groupIds: number[];
  projectIds: number[];
  settings: AdditionalInviteSettings;
  joiningDate?: string;
  jobTitle?: string;
  /**
   * Employee code per recipient, keyed by email.
   *
   * Keyed rather than positional because the code belongs to the person, not
   * to a slot in the list — every other field on this payload is shared by the
   * whole batch, and this one cannot be.
   */
  employeeCodeByEmail?: Record<string, string>;
  expiresInHours?: number;
}

export interface InviteLinkPayload {
  organizationId: number;
  email: string;
  role: InviteUserRole;
  groupIds: number[];
  projectIds: number[];
  settings: AdditionalInviteSettings;
  joiningDate?: string;
  jobTitle?: string;
  employeeCode?: string;
  /** Admin-defined role; the server derives the base role from it. */
  roleId?: number | null;
  expiresInHours?: number;
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
  timezone?: string;
  jobTitle?: string;
  employeeCode?: string;
  joiningDate?: string;
  skippedRoleLabel?: string;
}

export interface CsvParseResult {
  rows: CsvParseRow[];
  errors: string[];
}

interface BulkInviteRowPayload {
  email: string;
  role: InviteUserRole;
  group_ids?: number[];
  department_ids?: number[];
  project_ids?: number[];
  job_title?: string;
  employee_code?: string;
  joining_date?: string;
  settings?: Record<string, any>;
}

/**
 * The subset of the email => employee-code map covering `emails`.
 *
 * Returns nothing at all when the subset is empty, so the key stays off the
 * request body rather than being sent as `{}`.
 */
function pickEmployeeCodes(
  codes: Record<string, string> | undefined,
  emails: string[],
): { employee_codes?: Record<string, string> } {
  if (!codes) return {};

  const picked: Record<string, string> = {};
  emails.forEach((email) => {
    const code = codes[email]?.trim();
    if (code) picked[email] = code;
  });

  return Object.keys(picked).length > 0 ? { employee_codes: picked } : {};
}

type TabularRow = unknown[];
type XlsxSheetResult = {
  sheet?: string;
  data?: TabularRow[];
};

const INVITE_DEFAULTS_KEY = 'carevance-add-user-defaults';

/**
 * Module-level, not a method, because `fetchGroups` needs it.
 *
 * `addUserService.fetchGroups` is handed to react-query as a bare function
 * reference, so `this` is undefined inside it — any `this.x()` call there
 * throws, the query fails, and the departments list silently comes back empty.
 */
function readStoredDefaults(): InviteDefaults {
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
}

const unwrapInviteResponsePayload = (rawData: any) => {
  if (rawData && typeof rawData === 'object' && rawData.data && typeof rawData.data === 'object') {
    return rawData.data;
  }

  return rawData;
};

const ensureInviteRequestSucceeded = (response: any, fallbackMessage: string) => {
  const status = Number(response?.status || 0);
  const rawData = response?.data;
  const payload = unwrapInviteResponsePayload(rawData);
  const explicitSuccess = typeof rawData?.success === 'boolean' ? rawData.success : undefined;

  if (status >= 400 || explicitSuccess === false) {
    const error: any = new Error(rawData?.message || payload?.message || fallbackMessage);
    error.response = {
      ...response,
      data: rawData,
    };
    throw error;
  }

  return payload || {};
};

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
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const compactHeader = (value: string) => {
  const words = toSlug(value).split(/\s+/).filter(Boolean);
  return words.filter((word, index) => index === 0 || word !== words[index - 1]).join('');
};

const deriveDisplayName = (email: string) => {
  const localPart = email.split('@')[0] || 'User';
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
};

/**
 * Read a spreadsheet joining date into `YYYY-MM-DD`, or null if it is not a date.
 *
 * Assembled from local date parts rather than `toISOString()`, which resolves
 * against UTC and lands a day early anywhere ahead of it — the shift that has
 * bitten date-only values elsewhere in the app. An unreadable value returns
 * null so the caller can report the row instead of silently importing a person
 * with no start date.
 */
const normalizeJoiningDate = (raw: string): string | undefined => {
  const value = raw.trim();
  if (!value) return undefined;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;

  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${parsed.getFullYear()}-${month}-${day}`;
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

/**
 * Split recipients into one list per distinct role.
 *
 * Same-role recipients are merged even when other roles sit between them in the
 * input, because each group becomes an HTTP request and merging is what keeps
 * the request count at one-per-role rather than one-per-run-of-role. Ordering
 * within a group, and the order of the groups themselves, follows first
 * appearance — so the requests go out in a predictable order and a partial
 * failure is still legible in the results list, which is keyed by email anyway.
 *
 * Returned as entries rather than a Map purely so the caller can iterate it
 * without worrying about insertion-order guarantees.
 */
export const groupEmailsByRole = (
  emails: string[],
  defaultRole: InviteUserRole,
  overrides?: Record<string, InviteUserRole>,
): Array<[InviteUserRole, string[]]> => {
  const groups: Array<[InviteUserRole, string[]]> = [];

  for (const email of emails) {
    const role = overrides?.[email.trim().toLowerCase()] ?? defaultRole;
    const existing = groups.find(([groupRole]) => groupRole === role);
    if (existing) {
      existing[1].push(email);
    } else {
      groups.push([role, [email]]);
    }
  }

  return groups;
};

const chunkItems = <T>(items: T[], chunkSize: number): T[][] => {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
};

const normalizeCell = (value: unknown) => String(value ?? '').trim();

const getHeaderIndex = (headers: string[], aliases: string[]) => {
  const normalizedAliases = new Set(aliases.map((alias) => compactHeader(alias)));

  return headers.findIndex((header) => normalizedAliases.has(compactHeader(header)));
};

const extractXlsxRows = (value: unknown): TabularRow[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  if (value.every((row) => Array.isArray(row))) {
    return value as TabularRow[];
  }

  const firstSheet = (value as XlsxSheetResult[]).find((sheet) => Array.isArray(sheet?.data));
  return firstSheet?.data || [];
};

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
    // Flagged against the admin's own remembered selection, not against
    // "has any members at all" — that marked every department DEFAULT, so the
    // badge appeared on all ten and told the admin nothing.
    const remembered = new Set(readStoredDefaults().groupIds);

    return groups.map((group) => ({
      id: group.id,
      name: group.name,
      description: `${group.users.length} member${group.users.length === 1 ? '' : 's'}`,
      isDefault: remembered.has(group.id),
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
  
  loadDefaults: readStoredDefaults,

  saveDefaults(defaults: InviteDefaults) {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(INVITE_DEFAULTS_KEY, JSON.stringify(defaults));
  },

  clearDefaults() {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(INVITE_DEFAULTS_KEY);
  },

  async inviteByEmail(payload: InviteSubmissionPayload): Promise<InviteSubmissionResult> {
    /*
     * Chunked, because the API caps a single request at EMAIL_BATCH_LIMIT.
     *
     * The tag input happily accepted any number of addresses while the request
     * refused more than fifty, so pasting a real hiring list assembled the
     * whole thing and then failed on the count. The CSV path already chunked;
     * this one now does too, which turns the ceiling into an implementation
     * detail rather than something the admin has to know.
     */
    /*
     * Grouped by role first, then chunked within each group.
     *
     * StoreInvitationRequest takes a single `role` for the whole request, so a
     * batch containing two employees and a manager cannot be one call. Grouping
     * here means the admin sets a role per person and the transport detail —
     * one request per distinct role — stays out of the UI.
     */
    const groups = groupEmailsByRole(payload.emails, payload.role, payload.roleByEmail);
    let invitedCount = 0;
    const failed: Array<{ email: string; message: string }> = [];

    const requests = groups.flatMap(([role, emails]) =>
      chunkItems(emails, EMAIL_BATCH_LIMIT).map((chunk) => ({ role, chunk })),
    );

    for (const { role, chunk } of requests) {
      const response = await invitationApi.create({
        organization_id: payload.organizationId,
        emails: chunk,
        role,
        delivery: 'email',
        department_ids: payload.groupIds,
        project_ids: payload.projectIds,
        ...(payload.joiningDate ? { joining_date: payload.joiningDate } : {}),
        ...(payload.jobTitle ? { job_title: payload.jobTitle } : {}),
        ...(payload.roleId ? { role_id: payload.roleId } : {}),
        // Narrowed to this chunk. Emails are split by role and batch size, so
        // sending the whole map to every request would reserve a code against
        // a request that is not inviting that person.
        ...pickEmployeeCodes(payload.employeeCodeByEmail, chunk),
        ...(payload.expiresInHours ? { expires_in_hours: payload.expiresInHours } : {}),
        settings: {
          monitoring_interval_minutes: payload.settings.monitoringInterval,
          can_edit_time: payload.settings.canEditTime,
          attendance_monitoring: payload.settings.attendanceMonitoring,
          payroll_visibility: payload.settings.payrollVisibility,
          task_assignment_access: payload.settings.taskAssignmentAccess,
          ...(payload.settings.timezone ? { timezone: payload.settings.timezone } : {}),
        },
      });

      const responsePayload = ensureInviteRequestSucceeded(response, 'Failed to send invites.');
      failed.push(...(Array.isArray(responsePayload.failed) ? responsePayload.failed : []));
      invitedCount += Number(
        responsePayload.invited_count
        ?? responsePayload.invitedCount
        ?? (Array.isArray(responsePayload.invitations) ? responsePayload.invitations.length : 0)
      ) || 0;
    }

    if (invitedCount === 0 && failed.length === 0) {
      throw new Error('No invitations were created.');
    }

    return {
      invitedCount,
      failed,
      deferredAssignments: [],
    };
  },

  async generateInviteLink(payload: InviteLinkPayload) {
    const response = await invitationApi.create({
      organization_id: payload.organizationId,
      email: payload.email,
      role: payload.role,
      delivery: 'link',
      department_ids: payload.groupIds,
      project_ids: payload.projectIds,
      ...(payload.joiningDate ? { joining_date: payload.joiningDate } : {}),
      ...(payload.jobTitle ? { job_title: payload.jobTitle } : {}),
      ...(payload.employeeCode ? { employee_code: payload.employeeCode } : {}),
      ...(payload.roleId ? { role_id: payload.roleId } : {}),
      ...(payload.expiresInHours ? { expires_in_hours: payload.expiresInHours } : {}),
      settings: {
        monitoring_interval_minutes: payload.settings.monitoringInterval,
        can_edit_time: payload.settings.canEditTime,
        attendance_monitoring: payload.settings.attendanceMonitoring,
        payroll_visibility: payload.settings.payrollVisibility,
        task_assignment_access: payload.settings.taskAssignmentAccess,
        ...(payload.settings.timezone ? { timezone: payload.settings.timezone } : {}),
      },
    });

    const responsePayload = ensureInviteRequestSucceeded(response, 'Failed to generate invite link.');
    const invitations = Array.isArray(responsePayload.invitations) ? responsePayload.invitations : [];
    const invitation = invitations[0];

    if (!invitation?.invite_url) {
      const error: any = new Error(responsePayload.message || 'Invite link could not be generated.');
      error.response = { ...response, data: response.data };
      throw error;
    }

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
      .filter((row) => Array.isArray(row))
      .map((row) => row.map((cell) => normalizeCell(cell)))
      .filter((row) => row.some((cell) => cell !== ''));

    if (normalizedRows.length === 0) {
      return { rows: [], errors: ['Import file is empty.'] };
    }

    const [headerRow, ...dataRows] = normalizedRows;
    const headers = headerRow.map((header) => toSlug(header));
    const rows: CsvParseRow[] = [];
    const errors: string[] = [];

    const emailIndex = getHeaderIndex(headers, ['email', 'email address', 'email id', 'e mail', 'mail', 'user email', 'employee email']);
    const nameIndex = getHeaderIndex(headers, ['name', 'full name', 'user name', 'employee name']);
    const accessRoleIndex = getHeaderIndex(headers, ['access role', 'access_role', 'access', 'access level', 'permission', 'permissions', 'user role', 'account type']);
    const roleIndex = accessRoleIndex >= 0 ? accessRoleIndex : getHeaderIndex(headers, ['role']);
    const groupIndex = getHeaderIndex(headers, ['groups', 'group', 'group ids', 'group id', 'team', 'teams', 'department', 'departments']);
    const projectIndex = getHeaderIndex(headers, ['projects', 'project', 'project ids', 'project id']);
    const timezoneIndex = getHeaderIndex(headers, ['timezone', 'time zone', 'tz']);
    const jobTitleIndex = getHeaderIndex(headers, ['job title', 'job_title', 'job role', 'designation', 'position']);
    const joiningDateIndex = getHeaderIndex(headers, ['joining date', 'joining_date', 'date of joining', 'start date', 'doj']);
    // The organisation's own identifier, so the aliases cover what a legacy HR
    // export is likely to have called it rather than one canonical spelling.
    const employeeCodeIndex = getHeaderIndex(headers, ['employee code', 'employee_code', 'emp code', 'emp_code', 'employee id', 'employee_id', 'emp id', 'staff id', 'staff code', 'payroll id', 'code']);

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

      if (accessRoleIndex >= 0 && rawRole && !role) {
        errors.push(`Row ${index + 2}: unsupported access role "${rawRole}". Use employee, manager, or admin.`);
        return;
      }

      const rawTimezone = timezoneIndex >= 0 ? (columns[timezoneIndex] || '').trim() : '';
      const rawJobTitle = jobTitleIndex >= 0 ? (columns[jobTitleIndex] || '').trim() : '';
      const rawEmployeeCode = employeeCodeIndex >= 0 ? (columns[employeeCodeIndex] || '').trim() : '';
      const rawJoiningDate = joiningDateIndex >= 0 ? (columns[joiningDateIndex] || '').trim() : '';
      const joiningDate = normalizeJoiningDate(rawJoiningDate);

      if (rawJoiningDate && !joiningDate) {
        errors.push(`Row ${index + 2}: could not read joining date "${rawJoiningDate}". Use YYYY-MM-DD.`);
        return;
      }

      rows.push({
        email,
        name: (columns[nameIndex] || '').trim() || deriveDisplayName(email),
        role: role || 'employee',
        groupIds: mapOptionNamesToIds(parseMultiValueField(columns[groupIndex] || ''), groups),
        projectIds: mapOptionNamesToIds(parseMultiValueField(columns[projectIndex] || ''), projects),
        timezone: rawTimezone || undefined,
        jobTitle: rawJobTitle || (rawRole && !role ? rawRole : undefined),
        employeeCode: rawEmployeeCode || undefined,
        joiningDate,
        skippedRoleLabel: rawRole && !role ? rawRole : undefined,
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
      const rawRows = await readXlsxFile(file);
      const tableRows = extractXlsxRows(rawRows);

      if (tableRows.length === 0) {
        return { rows: [], errors: ['XLSX file is empty.'] };
      }

      return this.parseTableRows(tableRows, groups, projects);
    }

    return {
      rows: [],
      errors: ['Unsupported file format. Please upload a CSV or XLSX file.'],
    };
  },

  /**
   * Send rows that have already been parsed and shown to the admin.
   *
   * Split out from `processImportFile` so the CSV tab can validate first and
   * commit second. Choosing a file used to parse *and* invite in one action, so
   * a mis-mapped column in a 200-row sheet was discovered only after 200 people
   * had been emailed.
   */
  async sendParsedRows(
    parsed: CsvParseResult,
    basePayload: {
      organizationId: number;
      defaultGroupIds: number[];
      defaultProjectIds: number[];
      settings: AdditionalInviteSettings;
      joiningDate?: string;
    }
  ) {
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
    const ignoredRoleLabels = Array.from(new Set(
      parsed.rows
        .map((row) => row.skippedRoleLabel)
        .filter((value): value is string => Boolean(value))
    ));
    const deferredAssignments = new Set<string>();
    const rows: BulkInviteRowPayload[] = parsed.rows.map((row) => ({
      email: row.email,
      role: row.role,
      department_ids: row.groupIds,
      project_ids: row.projectIds,
      job_title: row.jobTitle || row.skippedRoleLabel || undefined,
      ...(row.employeeCode ? { employee_code: row.employeeCode } : {}),
      ...(row.joiningDate ? { joining_date: row.joiningDate } : {}),
      ...(row.timezone ? { settings: { timezone: row.timezone } } : {}),
    }));
    const rowChunks = chunkItems<BulkInviteRowPayload>(rows, 250);

    for (const rowChunk of rowChunks) {
      try {
        const response = await invitationApi.importCsv({
          rows: rowChunk,
          default_department_ids: basePayload.defaultGroupIds,
          default_project_ids: basePayload.defaultProjectIds,
          ...(basePayload.joiningDate ? { joining_date: basePayload.joiningDate } : {}),
          settings: {
            monitoring_interval_minutes: basePayload.settings.monitoringInterval,
            can_edit_time: basePayload.settings.canEditTime,
            attendance_monitoring: basePayload.settings.attendanceMonitoring,
            payroll_visibility: basePayload.settings.payrollVisibility,
            task_assignment_access: basePayload.settings.taskAssignmentAccess,
            ...(basePayload.settings.timezone ? { timezone: basePayload.settings.timezone } : {}),
          },
        });

        const responsePayload = ensureInviteRequestSucceeded(response, 'Unable to import this CSV batch.');
        invitedCount += Number(responsePayload.invited_count || 0) || 0;
        failed.push(...(Array.isArray(responsePayload.failed) ? responsePayload.failed : []));
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

    if (ignoredRoleLabels.length > 0) {
      deferredAssignments.add(`Role values such as "${ignoredRoleLabels.slice(0, 3).join('", "')}" were treated as job titles, so those rows were imported with employee access.`);
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
    /*
     * Job titles belong in job_title, permissions in access_role.
     *
     * The template used to put "Software Engineer" in a `role` column and the
     * permission in `access_role`, leaving `job_title` empty — so the file an
     * admin opened demonstrated the confusing arrangement rather than the clear
     * one. The parser still accepts `role` as an alias for files exported from
     * elsewhere; the template no longer teaches it.
     *
     * employee_code is included even though it is optional. It is the one
     * column an organisation cannot reconstruct later without asking every
     * person individually, and a bulk import is the only practical moment to
     * carry hundreds of them across from a previous system — so leaving it out
     * of the very file people learn the format from is how it gets missed.
     */
    const template = [
      'email,name,access_role,employee_code,job_title,departments,projects,joining_date,timezone',
      'alex@example.com,Alex Johnson,employee,EMP-001,Software Engineer,"Operations|Night Shift","CareVance HRMS",2026-09-01,Asia/Kolkata',
      'jordan@example.com,Jordan Lee,manager,EMP-002,Team Lead,"Operations","Implementation",2026-09-15,America/New_York',
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
