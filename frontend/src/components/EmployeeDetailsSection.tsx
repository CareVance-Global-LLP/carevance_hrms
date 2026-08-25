import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Award, FileText, CreditCard, Building2, Download, Eye, GraduationCap, Trash2, UserRound } from 'lucide-react';
import Button from '@/components/ui/Button';
import { FieldLabel, SelectInput, TextInput } from '@/components/ui/FormField';
import { useAuth } from '@/contexts/AuthContext';
import { validateGovernmentId } from '@/lib/idValidation';
import { canAccess } from '@/lib/permissions';
import { employeeWorkspaceApi, groupApi, myEmployeeRecordApi } from '@/services/api';
import { reportSilentError } from '@/lib/reportSilentError';
import type { MyEmployeeRecordsPayload } from '@/services/api';
import type { EmployeeWorkspacePayload } from '@/types';
import { COMMON_TIMEZONES } from '@/lib/timezones';
import { formatCalendarDate, formatTenure } from '@/lib/employeeDates';
import { usePlan } from '@/hooks/usePlan';

/**
 * The eight ABO/Rh groups. A free-text field here collects "O positive",
 * "O +ve" and "o+" for the same person, and the one moment this field matters
 * is the one where nobody has time to interpret it.
 */
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/**
 * The qualifications on offer, lowest first.
 *
 * A dropdown rather than free text because "B.Tech", "BTech", "B Tech" and
 * "Bachelor of Technology" are the same qualification, and four spellings of it
 * make the field unreportable — which is the whole reason education became a
 * record instead of a loose file.
 */
const QUALIFICATION_OPTIONS = [
  '10th',
  '12th',
  'Diploma',
  "Bachelor's Degree",
  "Master's Degree",
  'Doctorate (PhD)',
  'Professional Certification',
  'Other',
];

/**
 * What an employee's previous employment is evidenced by.
 *
 * These are documents, not records: with no employer, dates or role captured,
 * there is no fact here beyond "a relieving letter exists". So they are stored
 * as employee documents under one category, with the selected type as the
 * title, rather than in a table of their own.
 */
const EXPERIENCE_DOCUMENT_TYPES = [
  'Offer Letter',
  'Appointment Letter',
  'Experience Certificate',
  'Relieving Letter',
  'Last Salary Slip',
  'Form 16 (previous employer)',
  'Other',
];

/** What this form writes for a new experience document. */
const EXPERIENCE_CATEGORY = 'experience_document';

/*
 * Every category that means "evidence of previous employment".
 *
 * The list is long because the stored data and the upload form never agreed.
 * The category dropdown offered 'education' / 'experience' / 'identity' /
 * 'address' / 'other', while what is actually on the database is id_proof (99),
 * education (38), offer_letter (34), address_proof (30), experience_letter
 * (29), relieving_letter (27) and resume (26) — categories the form could not
 * produce, written by the seeder and by earlier upload paths.
 *
 * Matching only the new value would have left the Experience section reading
 * "No experience documents on file" for an employee with four of them.
 */
const EXPERIENCE_CATEGORIES = [
  EXPERIENCE_CATEGORY,
  'offer_letter',
  'appointment_letter',
  'experience_letter',
  'relieving_letter',
  'resume',
  'experience',
];

const EDUCATION_CATEGORY = 'education_certificate';
const EDUCATION_CATEGORIES = [EDUCATION_CATEGORY, 'education'];

/**
 * Categories that belong to a section of their own.
 *
 * Filtered out of the generic Documents list so a certificate does not appear
 * twice on the page — once under Education and again under Documents.
 */
const OWNED_DOCUMENT_CATEGORIES = [
  'bank_proof',
  'government_id_proof',
  ...EDUCATION_CATEGORIES,
  ...EXPERIENCE_CATEGORIES,
];

/** The current-address keys, and their permanent counterparts, in one place. */
const ADDRESS_PAIRS: Array<{ current: string; permanent: string; label: string }> = [
  { current: 'address_line', permanent: 'permanent_address_line', label: 'Address' },
  { current: 'city', permanent: 'permanent_city', label: 'City' },
  { current: 'state', permanent: 'permanent_state', label: 'State' },
  { current: 'postal_code', permanent: 'permanent_postal_code', label: 'Postal code' },
];

/** The top-level blocks this component can render, in the order they appear. */
export type EmployeeDetailsSectionName =
  | 'personal'
  | 'work'
  | 'government'
  | 'education'
  | 'experience'
  | 'bank'
  | 'documents';

const ALL_SECTIONS: EmployeeDetailsSectionName[] = [
  'personal', 'work', 'government', 'education', 'experience', 'bank', 'documents',
];

interface EmployeeDetailsSectionProps {
  /**
   * Primary key used for the workspace lookup. When provided, takes
   * precedence over `employeeCode`. Numeric user IDs are the most
   * reliable way to identify a user across the codebase.
   */
  userId?: number | null;
  /** String employee code. Used as a display label only when no display name is available. */
  employeeCode?: string;
  showHeader?: boolean;
  editable?: boolean;
  /**
   * Which blocks to render. Defaults to all of them, so every existing caller
   * is unaffected.
   *
   * Settings > Profile passes a subset because it already owns a "Personal
   * details" card of its own, and because work info and education are not the
   * employee's to edit.
   */
  sections?: EmployeeDetailsSectionName[];
  /**
   * Read and write the signed-in user's OWN record through `/me/*` instead of
   * the id-addressed `/employees/{id}/*` routes.
   *
   * The two return the same keys, so only the transport changes. This exists
   * because the admin routes are gated on role:admin,manager and take an id —
   * an employee cannot call them at all, and should not be able to.
   */
  selfService?: boolean;
}

/** What a given ID type should look like, shown before anything is typed. */
const govIdHint = (idType?: string): string => {
  switch ((idType || '').toLowerCase()) {
    case 'aadhaar': return '12 digits';
    case 'pan': return 'ABCPE1234F';
    case 'passport': return 'One letter then 7 digits';
    case 'driving_license': return 'State code then numbers';
    case 'voter_id': return 'ABC1234567';
    case 'uan': return '12 digits';
    case 'esi': return '17 digits';
    default: return 'ID number';
  }
};

export default function EmployeeDetailsSection({
  userId,
  employeeCode,
  showHeader = false,
  editable,
  sections = ALL_SECTIONS,
  selfService = false,
}: EmployeeDetailsSectionProps) {
  /** Whether a given block was asked for. */
  const shows = (section: EmployeeDetailsSectionName) => sections.includes(section);
  // Use the numeric userId as the lookup key whenever available — it's
  // always accurate, while employee_code strings can be mangled or
  // omitted for new users.
  const id = userId != null ? String(userId) : (employeeCode ?? '');
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [aboutForm, setAboutForm] = useState<Record<string, string>>({});
  const [workForm, setWorkForm] = useState<Record<string, any>>({});
  const [govForm, setGovForm] = useState<Record<string, any>>({ id_type: 'aadhaar', id_number: '', status: 'pending' });
  const [educationForm, setEducationForm] = useState<Record<string, any>>({
    qualification: '',
    certificate_file: null,
  });
  const [experienceForm, setExperienceForm] = useState<Record<string, any>>({
    title: '',
    file: null,
  });

  /*
   * Derived, not state: recomputing on render keeps the message in step with
   * the field instead of trailing it by a keystroke, which is what a second
   * useState here would do.
   */
  const govIdCheck = govForm.id_number
    ? validateGovernmentId(govForm.id_type || 'aadhaar', govForm.id_number)
    : null;
  const [bankForm, setBankForm] = useState<Record<string, any>>({
    bank_name: '',
    account_number: '',
    ifsc_swift: '',
    branch: '',
    account_type: '',
    payout_method: 'bank_transfer',
    is_default: true,
  });
  const canEditOwnProfile = editable ? true : false;
  const { hasFeature } = usePlan();
  const hasPayrollFeature = hasFeature('payroll');

  /*
   * Two sources, one shape. The self-service read returns a strict subset of
   * the workspace payload — employee, bank_accounts, government_ids, documents
   * — so every section body below reads the same keys either way. Its own
   * query key keeps the two caches apart: an admin viewing this person and the
   * person viewing themselves see different document sets, and sharing a key
   * would let one overwrite the other.
   */
  const workspaceQueryKey = selfService ? ['my-employee-records'] : ['employee-workspace', id];

  /**
   * Refresh this record AND anything reading the onboarding checklist.
   *
   * A document upload can complete a checklist item on the server, and until
   * the panels showing that checklist are told, they keep rendering the pending
   * circle they cached. That is the whole reason ticking felt manual: the
   * backend had already completed the item and no screen went back to look.
   *
   * All three onboarding keys, because this one component is the upload surface
   * for every side — the joiner's own Settings page, and both admin views of
   * somebody else's record — and the tick has to land wherever it is being
   * watched.
   */
  const invalidateRecordAndOnboarding = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: workspaceQueryKey }),
      queryClient.invalidateQueries({ queryKey: ['my-onboarding'] }),
      queryClient.invalidateQueries({ queryKey: ['onboarding-journey'] }),
      queryClient.invalidateQueries({ queryKey: ['onboarding-journeys'] }),
    ]);
  };

  const workspaceQuery = useQuery({
    queryKey: workspaceQueryKey,
    /*
     * Everything beyond the four self-service keys is optional in this type,
     * which is the honest description of a component that can be fed either
     * payload — and it is what makes TypeScript insist the personal, work and
     * education blocks handle their data being absent.
     */
    queryFn: async (): Promise<Partial<EmployeeWorkspacePayload> & MyEmployeeRecordsPayload> => (
      selfService
        ? (await myEmployeeRecordApi.getRecords()).data
        : (await employeeWorkspaceApi.getWorkspace(id)).data
    ),
    enabled: selfService || Boolean(id),
  });

  // Only fetched when the department picker can actually be shown.
  const groupsQuery = useQuery({
    queryKey: ['groups', 'employee-work-info'],
    queryFn: async () => (await groupApi.getAll()).data?.data ?? [],
    enabled: Boolean(editable),
  });

  useEffect(() => {
    if (!workspaceQuery.data) return;
    setAboutForm({
      first_name: workspaceQuery.data.about?.first_name || '',
      // Present on the profile and sent by the Add User wizard, but never
      // rendered here — so a middle name could be captured at hire and then
      // silently dropped by the first edit this form saved.
      middle_name: (workspaceQuery.data.about as any)?.middle_name || '',
      last_name: workspaceQuery.data.about?.last_name || '',
      gender: workspaceQuery.data.about?.gender || '',
      date_of_birth: String(workspaceQuery.data.about?.date_of_birth || '').slice(0, 10),
      blood_group: (workspaceQuery.data.about as any)?.blood_group || '',
      phone: workspaceQuery.data.about?.phone || '',
      personal_email: workspaceQuery.data.about?.personal_email || '',
      address_line: workspaceQuery.data.about?.address_line || '',
      city: workspaceQuery.data.about?.city || '',
      state: workspaceQuery.data.about?.state || '',
      postal_code: workspaceQuery.data.about?.postal_code || '',
      permanent_address_line: (workspaceQuery.data.about as any)?.permanent_address_line || '',
      permanent_city: (workspaceQuery.data.about as any)?.permanent_city || '',
      permanent_state: (workspaceQuery.data.about as any)?.permanent_state || '',
      permanent_postal_code: (workspaceQuery.data.about as any)?.permanent_postal_code || '',
      emergency_contact_name: workspaceQuery.data.about?.emergency_contact_name || '',
      emergency_contact_number: workspaceQuery.data.about?.emergency_contact_number || '',
      emergency_contact_relationship: workspaceQuery.data.about?.emergency_contact_relationship || '',
    });
    setWorkForm({
      employee_code: workspaceQuery.data.work_info?.employee_code || '',
      designation: workspaceQuery.data.work_info?.designation || '',
      employment_type: workspaceQuery.data.work_info?.employment_type || '',
      work_location: workspaceQuery.data.work_info?.work_location || '',
      // Sliced because the API serialises a date-only column as an ISO string;
      // an <input type="date"> will not accept the time portion.
      joining_date: (workspaceQuery.data.work_info?.joining_date || '').slice(0, 10),
      report_group_id: workspaceQuery.data.work_info?.report_group_id
        ? String(workspaceQuery.data.work_info.report_group_id)
        : '',
      work_mode: workspaceQuery.data.work_info?.work_mode || '',
      expected_start_time: workspaceQuery.data.work_info?.expected_start_time || '',
      expected_timezone: workspaceQuery.data.work_info?.expected_timezone || '',
    });

    const savedBank = workspaceQuery.data.bank_accounts?.find((item: any) => item.is_default) || workspaceQuery.data.bank_accounts?.[0];
    if (savedBank) {
      setBankForm({
        bank_name: savedBank.bank_name || '',
        account_number: savedBank.account_number || '',
        ifsc_swift: savedBank.ifsc_swift || '',
        branch: savedBank.branch || '',
        account_type: savedBank.account_type || '',
        payout_method: savedBank.payout_method || 'bank_transfer',
        is_default: Boolean(savedBank.is_default),
      });
    }
  }, [workspaceQuery.data]);

  const saveAboutMutation = useMutation({
    mutationFn: async () => employeeWorkspaceApi.updateProfile(id, aboutForm),
    onSuccess: async () => {
      setFeedback({ tone: 'success', message: 'Personal details saved.' });
      await queryClient.invalidateQueries({ queryKey: workspaceQueryKey });
    },
    onError: (error: any) => {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Could not save personal details.' });
    },
  });

  const saveWorkMutation = useMutation({
    mutationFn: async () => employeeWorkspaceApi.updateWorkInfo(id, {
      // The employment fields are editable here so an admin who skipped the
      // employee code at invitation time has somewhere to put it. Every value
      // is sent as null rather than '' when cleared, so the column ends up
      // genuinely empty instead of holding a blank string.
      employee_code: workForm.employee_code?.trim() || null,
      designation: workForm.designation?.trim() || null,
      report_group_id: workForm.report_group_id ? Number(workForm.report_group_id) : null,
      joining_date: workForm.joining_date || null,
      employment_type: workForm.employment_type?.trim() || null,
      work_location: workForm.work_location?.trim() || null,
      work_mode: workForm.work_mode || null,
      expected_start_time: workForm.expected_start_time || null,
      expected_timezone: workForm.expected_timezone || null,
    }),
    onSuccess: async () => {
      setFeedback({ tone: 'success', message: 'Work information saved.' });
      await queryClient.invalidateQueries({ queryKey: workspaceQueryKey });
    },
    onError: (error: any) => {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Could not save work information.' });
    },
  });

  const saveGovMutation = useMutation({
    mutationFn: async () => (selfService ? myEmployeeRecordApi.saveGovernmentId : (data: any) => employeeWorkspaceApi.saveGovernmentId(id, data))({
      ...govForm,
      proof_file: govForm.proof_file || null,
    }),
    onSuccess: async () => {
      setFeedback({ tone: 'success', message: 'Government ID saved successfully.' });
      setGovForm({ id_type: 'aadhaar', id_number: '', status: 'pending' });
      await invalidateRecordAndOnboarding();
    },
    onError: (error: any) => {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Could not save government ID.' });
    },
  });

  const saveEducationMutation = useMutation({
    mutationFn: async () => (selfService ? myEmployeeRecordApi.saveEducation : (data: any) => employeeWorkspaceApi.saveEducation(id, data))({
      ...educationForm,
      certificate_file: educationForm.certificate_file || null,
    }),
    onSuccess: async () => {
      setFeedback({ tone: 'success', message: 'Education record saved.' });
      setEducationForm({ qualification: '', certificate_file: null });
      await invalidateRecordAndOnboarding();
    },
    onError: (error: any) => {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Could not save the education record.' });
    },
  });

  const removeEducationMutation = useMutation({
    mutationFn: async (educationId: number) => (
      selfService
        ? myEmployeeRecordApi.deleteEducation(educationId)
        : employeeWorkspaceApi.deleteEducation(id, educationId)
    ),
    onSuccess: async () => {
      setFeedback({ tone: 'success', message: 'Education record removed. The certificate stays on file.' });
      await queryClient.invalidateQueries({ queryKey: workspaceQueryKey });
    },
    onError: (error: any) => {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Could not remove the education record.' });
    },
  });

  /*
   * Experience reuses the document upload rather than a table of its own: the
   * selected type IS the whole record, and it is already exactly what
   * EmployeeDocument's title and category model.
   */
  const saveExperienceMutation = useMutation({
    /*
     * A plain object, not a FormData.
     *
     * Both upload clients build the FormData themselves from `data.title`,
     * `data.category` and `data.file`. This used to hand them an
     * already-assembled FormData cast through `as any` — so every one of those
     * reads was `undefined`, the request posted the literal string "undefined"
     * as the file, and the server rejected it. The cast is what stopped
     * TypeScript from saying so.
     */
    mutationFn: async () => {
      if (!experienceForm.file) {
        throw new Error('Choose a file to upload.');
      }

      const payload = {
        title: experienceForm.title,
        category: EXPERIENCE_CATEGORY,
        file: experienceForm.file as File,
      };

      return selfService
        ? myEmployeeRecordApi.uploadDocument(payload)
        : employeeWorkspaceApi.uploadDocument(id, { ...payload, review_status: 'pending' });
    },
    onSuccess: async () => {
      setFeedback({ tone: 'success', message: 'Experience document uploaded.' });
      setExperienceForm({ title: '', file: null });
      await invalidateRecordAndOnboarding();
    },
    onError: (error: any) => {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Could not upload the experience document.' });
    },
  });

  const saveBankMutation = useMutation({
    mutationFn: async () => (selfService ? myEmployeeRecordApi.saveBankAccount : (data: any) => employeeWorkspaceApi.saveBankAccount(id, data))({
      ...bankForm,
      proof_file: bankForm.proof_file || null,
    }),
    onSuccess: async () => {
      setFeedback({ tone: 'success', message: 'Bank details saved successfully.' });
      await invalidateRecordAndOnboarding();
    },
    onError: (error: any) => {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Could not save bank details.' });
    },
  });

  if (workspaceQuery.isLoading) {
    return <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Loading employee details...</div>;
  }

  if (workspaceQuery.isError || !workspaceQuery.data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-sm text-red-700">Failed to load employee details.</p>
        <Button variant="secondary" className="mt-3" onClick={() => void workspaceQuery.refetch()}>Retry</Button>
      </div>
    );
  }

  const data = workspaceQuery.data;

  const buildDocFilename = (proofType: string, ext?: string) => {
    const empCode = data.work_info?.employee_code || id;
    const name = (data.employee?.name || 'employee').replace(/\s+/g, '_');
    const department = data.work_info?.department?.name || 'Dept';
    const suffix = ext || '';
    return `${empCode}_${name}_${department}_${proofType}${suffix}`;
  };

  const isPreviewable = (mimeType?: string, fileName?: string) => {
    if (mimeType) return mimeType.startsWith('image/') || mimeType === 'application/pdf';
    if (fileName) {
      const ext = fileName.split('.').pop()?.toLowerCase();
      return ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext || '');
    }
    return false;
  };

  /*
   * Both of these used to end at `.then(...)` with no rejection path, so a
   * refused download was completely silent — the button simply did nothing, and
   * "nothing happens" gives no clue whether the file is missing, forbidden, or
   * the request never left. That is what made a 403 on a proof document look
   * like a broken button.
   *
   * The response body is a Blob because of responseType, so the server's JSON
   * message has to be read back out of it rather than off `error.response.data`.
   */
  const reportDownloadFailure = async (error: any, fallback: string) => {
    const status = error?.response?.status;
    let message = fallback;

    if (status === 403) {
      message = 'You do not have permission to open this document.';
    } else if (status === 404) {
      message = 'That document is no longer on file.';
    } else {
      const body = error?.response?.data;
      if (body instanceof Blob) {
        try {
          const parsed = JSON.parse(await body.text());
          if (parsed?.message) message = parsed.message;
        } catch {
          reportSilentError('employeeDetails.download.parse', error);
        }
      }
    }

    setFeedback({ tone: 'error', message });
  };

  const fetchDocument = (docId: number) => (
    selfService
      ? myEmployeeRecordApi.downloadDocument(docId)
      : employeeWorkspaceApi.downloadDocument(id, docId)
  );

  const handleFilePreview = (docId: number, mimeType?: string, fileName?: string) => {
    fetchDocument(docId).then((res) => {
      const blob = new Blob([res.data], { type: mimeType || String(res.headers?.['content-type'] || '') });
      const blobUrl = window.URL.createObjectURL(blob);
      const opened = window.open(blobUrl, '_blank');

      // A blocked pop-up is the other way this reads as "the button does
      // nothing", and it is not something the request can tell us about.
      if (!opened) {
        setFeedback({
          tone: 'error',
          message: 'Your browser blocked the preview window. Allow pop-ups for this site, or use download instead.',
        });
      }

      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 100);
    }).catch((error) => reportDownloadFailure(error, 'Could not open that document.'));
  };

  const handleFileDownload = (docId: number, filename: string, mimeType?: string, fileName?: string) => {
    fetchDocument(docId).then((res) => {
      const blob = new Blob([res.data], { type: mimeType || String(res.headers?.['content-type'] || '') });
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 100);
    }).catch((error) => reportDownloadFailure(error, 'Could not download that document.'));
  };

  const canEditWorkInfo = editable ? true : (
    canAccess(user, 'employee.edit') ||
    user?.role === 'admin' ||
    (user?.role === 'manager' && (data.employee as any)?.reporting_manager_id === user?.id)
  );

  const about = data.about as any;

  const experienceDocuments = (data.documents ?? []).filter(
    (item: any) => EXPERIENCE_CATEGORIES.includes(item.category),
  );

  /*
   * Education certificates uploaded before qualifications became records, and
   * so attached to no row in the Education list. Shown inside that section
   * rather than left in the general pile: the file is the evidence for a
   * qualification nobody has recorded yet, and burying it under Documents is
   * what made it invisible.
   */
  const linkedEducationDocumentIds = new Set(
    ((data as any).educations ?? [])
      .map((record: any) => record.employee_document_id)
      .filter(Boolean),
  );
  const looseEducationDocuments = (data.documents ?? []).filter(
    (item: any) => EDUCATION_CATEGORIES.includes(item.category) && !linkedEducationDocumentIds.has(item.id),
  );

  /*
   * Everything that is not already surfaced by a section of its own. Education
   * certificates and experience documents joined bank and government-ID proofs
   * on this list, because a certificate showing up both under Education and
   * again under Documents reads as two uploads of the same thing.
   */
  const generalDocuments = (data.documents ?? []).filter(
    (item: any) => !OWNED_DOCUMENT_CATEGORIES.includes(item.category),
  );

  const aboutSummaryFields = [
    { label: 'Full Name (as per Aadhaar)', value: [about?.first_name, about?.middle_name, about?.last_name].filter(Boolean).join(' ') },
    { label: 'Gender', value: about?.gender },
    { label: 'Date of Birth', value: formatCalendarDate(about?.date_of_birth) },
    { label: 'Blood Group', value: about?.blood_group },
    { label: 'Phone', value: about?.phone },
    { label: 'Personal Email', value: about?.personal_email },
    { label: 'Current Address', value: [about?.address_line, about?.city, about?.state, about?.postal_code].filter(Boolean).join(', ') },
    { label: 'Permanent Address', value: [about?.permanent_address_line, about?.permanent_city, about?.permanent_state, about?.permanent_postal_code].filter(Boolean).join(', ') },
    { label: 'Emergency Contact', value: about?.emergency_contact_name },
    { label: 'Emergency Number', value: about?.emergency_contact_number },
    { label: 'Relationship', value: about?.emergency_contact_relationship },
  ];

  /**
   * Copy on tick, rather than storing a "same as current" flag.
   *
   * A stored flag would keep rewriting the permanent address every time the
   * current one changed — so an employee who relocates for work would silently
   * lose the permanent address their PF nomination is registered against, which
   * is the exact failure this field was added to prevent.
   */
  const copyCurrentAddressToPermanent = () => {
    setAboutForm((current) => {
      const next = { ...current };
      ADDRESS_PAIRS.forEach(({ current: from, permanent: to }) => {
        next[to] = current[from] || '';
      });
      return next;
    });
  };

  const textField = (key: string, label: string, type = 'text') => (
    <div key={key}>
      <FieldLabel>{label}</FieldLabel>
      <TextInput
        type={type}
        value={aboutForm[key] || ''}
        onChange={(event) => setAboutForm((currentForm) => ({ ...currentForm, [key]: event.target.value }))}
      />
    </div>
  );

  const workSummaryFields = [
    { label: 'Employee Code', value: data.work_info?.employee_code },
    { label: 'Designation', value: data.work_info?.designation },
    { label: 'Department', value: data.work_info?.department?.name },
    // Joining date anchors the onboarding checklist, the 30/60/90 probation
    // reviews, mid-month payroll proration and the five-year gratuity floor.
    // formatCalendarDate, not the raw value: rendered raw it prints the
    // serialised "…T18:30:00.000000Z" form.
    { label: 'Joining Date', value: formatCalendarDate(data.work_info?.joining_date) },
    { label: 'Tenure', value: formatTenure(data.work_info?.joining_date) },
    { label: 'Employment Type', value: data.work_info?.employment_type },
    { label: 'Work Location', value: data.work_info?.work_location },
    { label: 'Expected Start Time', value: data.work_info?.expected_start_time ? `${data.work_info.expected_start_time} (${data.work_info?.expected_timezone || 'Org timezone'})` : 'Not set (using org default)' },
  ];

  return (
    <div className="space-y-5">
      {/*
        Every mutation in this component has always called setFeedback, and
        nothing ever rendered it — so a save that 422'd on the server looked
        exactly like one that worked, and the six forms below reported failure
        into nowhere. It is rendered now.
      */}
      {feedback && (
        <div
          role="status"
          className={
            feedback.tone === 'success'
              ? 'rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800'
              : 'rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800'
          }
        >
          <div className="flex items-start justify-between gap-3">
            <span>{feedback.message}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="shrink-0 text-xs font-medium underline underline-offset-2"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {showHeader && (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Employee Details</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">{data.employee?.name || 'Employee'}</h1>
          <p className="mt-1 text-sm text-slate-500">{data.employee?.email || ''}</p>
        </section>
      )}

      {/*
        Personal details are their own section rather than part of the header
        block. They used to render only when showHeader was set, and the Add
        User wizard mounts this component without it — so the one screen whose
        entire purpose is capturing a new joiner's details showed every section
        except that one.
      */}
      {shows('personal') && (
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <UserRound className="h-5 w-5 text-blue-600" />
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Personal Details</p>
        </div>
        <p className="mt-1 text-sm text-slate-500">Identity, contact, addresses and who to call in an emergency.</p>

        {canEditOwnProfile ? (
          <>
            <div className="mt-6 space-y-6">
              <div>
                {/*
                  Named for the document it has to match. The three parts already
                  compose the legal name — the middle-name migration says so — and
                  a filing is rejected when the spelling differs from the Aadhaar
                  and PAN records, so the label is where that gets enforced.
                */}
                <p className="text-sm font-medium text-slate-900">Full name (as per Aadhaar)</p>
                <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
                  {textField('first_name', 'First name')}
                  {textField('middle_name', 'Middle name')}
                  {textField('last_name', 'Last name')}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]">
                <div>
                  <FieldLabel>Gender</FieldLabel>
                  <SelectInput
                    value={aboutForm.gender || ''}
                    onChange={(event) => setAboutForm((current) => ({ ...current, gender: event.target.value }))}
                  >
                    <option value="">Select gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                    <option value="prefer_not_to_say">Prefer not to say</option>
                  </SelectInput>
                </div>
                {textField('date_of_birth', 'Date of birth', 'date')}
                <div>
                  <FieldLabel>Blood group</FieldLabel>
                  <SelectInput
                    value={aboutForm.blood_group || ''}
                    onChange={(event) => setAboutForm((current) => ({ ...current, blood_group: event.target.value }))}
                  >
                    <option value="">Select blood group</option>
                    {BLOOD_GROUPS.map((group) => (
                      <option key={group} value={group}>{group}</option>
                    ))}
                  </SelectInput>
                </div>
                {textField('phone', 'Phone')}
                {textField('personal_email', 'Personal email', 'email')}
              </div>

              <div>
                <p className="text-sm font-medium text-slate-900">Current address</p>
                <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]">
                  {ADDRESS_PAIRS.map(({ current, label }) => textField(current, label))}
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900">Permanent address</p>
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-blue-600"
                      onChange={(event) => {
                        if (event.target.checked) copyCurrentAddressToPermanent();
                      }}
                    />
                    Same as current address
                  </label>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Kept separately from the current address: this is the one PF nomination and bank KYC are registered against.
                </p>
                <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]">
                  {ADDRESS_PAIRS.map(({ permanent, label }) => textField(permanent, label))}
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-slate-900">Emergency contact</p>
                <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
                  {textField('emergency_contact_name', 'Name')}
                  {textField('emergency_contact_number', 'Phone number')}
                  {textField('emergency_contact_relationship', 'Relationship')}
                </div>
              </div>
            </div>

            <div className="mt-6">
              <Button onClick={() => saveAboutMutation.mutate()} disabled={saveAboutMutation.isPending}>
                {saveAboutMutation.isPending ? 'Saving...' : 'Save Personal Info'}
              </Button>
            </div>
          </>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]">
            {aboutSummaryFields.map((field) => (
              <div key={field.label} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{field.label}</p>
                <p className="mt-2 text-sm font-medium text-slate-950">{field.value || 'Not added yet'}</p>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {shows('work') && (
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-blue-600" />
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Work Information</p>
        </div>
        <p className="mt-1 text-sm text-slate-500">Employment details, work schedule, and timezone settings.</p>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]">
          {workSummaryFields.map((field) => (
            <div key={field.label} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{field.label}</p>
              <p className="mt-2 text-sm font-medium text-slate-950">{field.value || 'Not added yet'}</p>
            </div>
          ))}
        </div>

        {canEditWorkInfo ? (
          <>
            <div className="mt-6 border-t border-slate-200 pt-6">
              <p className="text-sm font-medium text-slate-900">Edit Employment Details</p>
              <p className="mt-1 text-xs text-slate-500">
                The employee code is your organisation's own identifier and must be unique. If it was
                not set when this person was invited, add it here.
              </p>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <FieldLabel>Employee Code</FieldLabel>
                  <TextInput
                    maxLength={80}
                    value={workForm.employee_code || ''}
                    onChange={(event) => setWorkForm((current) => ({ ...current, employee_code: event.target.value }))}
                    placeholder="e.g., EMP-001"
                  />
                </div>
                <div>
                  <FieldLabel>Designation</FieldLabel>
                  <TextInput
                    maxLength={120}
                    value={workForm.designation || ''}
                    onChange={(event) => setWorkForm((current) => ({ ...current, designation: event.target.value }))}
                    placeholder="e.g., Senior Engineer"
                  />
                </div>
                <div>
                  <FieldLabel>Department</FieldLabel>
                  <SelectInput
                    value={workForm.report_group_id || ''}
                    onChange={(event) => setWorkForm((current) => ({ ...current, report_group_id: event.target.value }))}
                  >
                    <option value="">Not assigned</option>
                    {(groupsQuery.data ?? []).map((group: any) => (
                      <option key={group.id} value={String(group.id)}>{group.name}</option>
                    ))}
                  </SelectInput>
                </div>
                <div>
                  <FieldLabel>Joining Date</FieldLabel>
                  <TextInput
                    type="date"
                    value={workForm.joining_date || ''}
                    onChange={(event) => setWorkForm((current) => ({ ...current, joining_date: event.target.value }))}
                  />
                </div>
                <div>
                  <FieldLabel>Employment Type</FieldLabel>
                  <TextInput
                    maxLength={80}
                    value={workForm.employment_type || ''}
                    onChange={(event) => setWorkForm((current) => ({ ...current, employment_type: event.target.value }))}
                    placeholder="e.g., Full-time"
                  />
                </div>
                <div>
                  <FieldLabel>Work Location</FieldLabel>
                  <TextInput
                    maxLength={255}
                    value={workForm.work_location || ''}
                    onChange={(event) => setWorkForm((current) => ({ ...current, work_location: event.target.value }))}
                    placeholder="e.g., Bengaluru"
                  />
                </div>
                <div>
                  <FieldLabel>Work Mode</FieldLabel>
                  <SelectInput
                    value={workForm.work_mode || ''}
                    onChange={(event) => setWorkForm((current) => ({ ...current, work_mode: event.target.value }))}
                  >
                    <option value="">Not set</option>
                    <option value="office">Office</option>
                    <option value="remote">Remote</option>
                    <option value="hybrid">Hybrid</option>
                  </SelectInput>
                </div>
              </div>
            </div>

            <div className="mt-6 border-t border-slate-200 pt-6">
              <p className="text-sm font-medium text-slate-900">Edit Work Schedule</p>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <FieldLabel>Expected Start Time (HH:MM)</FieldLabel>
                  <TextInput
                    type="time"
                    value={workForm.expected_start_time || ''}
                    onChange={(event) => setWorkForm((current) => ({ ...current, expected_start_time: event.target.value }))}
                  />
                </div>
                <div>
                  <FieldLabel>Expected Timezone</FieldLabel>
                  <SelectInput
                    value={workForm.expected_timezone || ''}
                    onChange={(event) => setWorkForm((current) => ({ ...current, expected_timezone: event.target.value }))}
                  >
                    <option value="">Use organization default</option>
                    {COMMON_TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>{tz}</option>
                    ))}
                  </SelectInput>
                </div>
              </div>
            </div>
            <div className="mt-6">
              <Button onClick={() => saveWorkMutation.mutate()} disabled={saveWorkMutation.isPending}>
                {saveWorkMutation.isPending ? 'Saving...' : 'Save Work Info'}
              </Button>
            </div>
          </>
        ) : (
          <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-sm text-slate-500">
              {user?.role === 'manager'
                ? 'Only admins or the direct reporting manager can edit work information.'
                : 'Only admins or managers with edit permissions can modify work information.'}
            </p>
          </div>
        )}
      </section>
      )}

      {shows('government') && (
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-blue-600" />
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Government IDs</p>
        </div>
        <p className="mt-1 text-sm text-slate-500">Add Aadhaar, PAN, and other government identification documents.</p>

        {data.government_ids?.length > 0 && (
          <div className="mt-5 space-y-3">
            {data.government_ids.map((item: any) => (
              <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-950">{item.id_type}</p>
                    <p className="text-sm text-slate-500">{item.id_number}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.document?.id && (
                      <>
                        {isPreviewable(item.document.mime_type, item.document.file_name) && (
                          <button
                            type="button"
                            title={`View ${item.id_type} proof`}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
                            onClick={() => handleFilePreview(item.document.id, item.document.mime_type, item.document.file_name)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          title={`Download ${item.id_type} proof`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
                          onClick={() => handleFileDownload(item.document.id, buildDocFilename(item.id_type), item.document.mime_type, item.document.file_name)}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {(canEditOwnProfile || canEditWorkInfo) && (
          <div className="mt-6 border-t border-slate-200 pt-6">
            <p className="text-sm font-medium text-slate-900">Add New Government ID</p>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]">
              <div>
                <FieldLabel>ID Type</FieldLabel>
                <SelectInput
                  value={govForm.id_type || 'aadhaar'}
                  onChange={(event) => setGovForm((current) => ({ ...current, id_type: event.target.value }))}
                >
                  {/*
                    Lower-case values, and two more types.
                    
                    This list wrote 'AADHAAR' while EmployeeDetailWorkspace wrote
                    'aadhaar', so employee_government_ids holds both spellings for
                    the same kind of ID. User::statutoryId reads case-insensitively
                    so filings still resolve, but anything grouping on the raw
                    value sees them as different types. UAN and ESI were missing
                    here and are needed for PF and insurance.
                  */}
                  <option value="aadhaar">Aadhaar</option>
                  <option value="pan">PAN</option>
                  <option value="passport">Passport</option>
                  <option value="driving_license">Driving License</option>
                  <option value="voter_id">Voter ID</option>
                  <option value="uan">UAN (PF)</option>
                  <option value="esi">ESI Number</option>
                </SelectInput>
              </div>
              <div>
                <FieldLabel>ID Number</FieldLabel>
                {/*
                  Validated as you type, against lib/idValidation — Aadhaar runs
                  a real Verhoeff checksum, PAN matches ABCDE1234F.

                  The server validates too and returns 422, so this form used to
                  accept anything and surface the failure only after Save. The
                  validators already existed and EmployeeDetailWorkspace already
                  used them; this form did not.
                */}
                <TextInput
                  value={govForm.id_number || ''}
                  onChange={(event) => setGovForm((current) => ({ ...current, id_number: event.target.value }))}
                  placeholder={govIdHint(govForm.id_type)}
                  className={
                    govIdCheck?.error
                      ? 'border-rose-400 focus:border-rose-500'
                      : govIdCheck?.valid
                        ? 'border-emerald-400 focus:border-emerald-500'
                        : undefined
                  }
                />
                <p className="mt-1 text-xs">
                  {govIdCheck?.error ? (
                    <span className="text-rose-500">{govIdCheck.error}</span>
                  ) : govIdCheck?.valid ? (
                    <span className="text-emerald-600">Format valid — not a check that it belongs to this person</span>
                  ) : (
                    <span className="text-slate-500">Expected: {govIdHint(govForm.id_type)}</span>
                  )}
                </p>
              </div>
              <div>
                <FieldLabel>Proof Document</FieldLabel>
                <input
                  type="file"
                  className="block min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  onChange={(event) => setGovForm((current) => ({ ...current, proof_file: event.target.files?.[0] || null }))}
                />
              </div>
            </div>
            <div className="mt-4">
              <Button
                onClick={() => saveGovMutation.mutate()}
                disabled={saveGovMutation.isPending || !govForm.id_number}
              >
                {saveGovMutation.isPending ? 'Saving...' : 'Add Government ID'}
              </Button>
            </div>
          </div>
        )}
      </section>
      )}

      {/*
        Education as records rather than as loose files. A certificate could
        already be uploaded as a document with category 'education', which kept
        the scan and lost the facts — "who holds a B.Tech" meant opening every
        PDF one at a time.
      */}
      {shows('education') && (
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <GraduationCap className="h-5 w-5 text-blue-600" />
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Education</p>
        </div>
        <p className="mt-1 text-sm text-slate-500">Qualifications held, with the certificate for each.</p>

        {(data as any).educations?.length > 0 ? (
          <div className="mt-5 space-y-3">
            {(data as any).educations.map((item: any) => (
              <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-950">
                      {item.qualification}
                      {item.specialisation ? <span className="font-normal text-slate-500"> · {item.specialisation}</span> : null}
                    </p>
                    {/*
                      institution, year and grade are only ever present on rows
                      created before the form was reduced to a qualification and
                      a certificate. Shown when they exist rather than dropped,
                      so nothing already recorded disappears from the page.
                    */}
                    <p className="text-sm text-slate-500">
                      {[item.institution, item.year_of_passing, item.grade, item.document?.file_name]
                        .filter(Boolean)
                        .join(' · ') || 'No certificate attached'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {item.document?.id && (
                      <>
                        {isPreviewable(item.document.mime_type, item.document.file_name) && (
                          <button
                            type="button"
                            title={`View ${item.qualification} certificate`}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
                            onClick={() => handleFilePreview(item.document.id, item.document.mime_type, item.document.file_name)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          title={`Download ${item.qualification} certificate`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
                          onClick={() => handleFileDownload(item.document.id, buildDocFilename(`${item.qualification}_Certificate`), item.document.mime_type, item.document.file_name)}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                    {(canEditOwnProfile || canEditWorkInfo) && (
                      <button
                        type="button"
                        title={`Remove ${item.qualification}`}
                        disabled={removeEducationMutation.isPending}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition-colors disabled:opacity-50"
                        onClick={() => removeEducationMutation.mutate(item.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
            No qualifications recorded yet.
          </p>
        )}

        {looseEducationDocuments.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-slate-500">
              Certificates on file with no qualification recorded against them
            </p>
            <div className="mt-2 space-y-2">
              {looseEducationDocuments.map((item: any) => (
                <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg border border-dashed border-slate-200 bg-white px-4 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{item.title}</p>
                    <p className="text-xs text-slate-500">{item.file_name}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isPreviewable(item.mime_type, item.file_name) && (
                      <button
                        type="button"
                        title={`View ${item.title}`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
                        onClick={() => handleFilePreview(item.id, item.mime_type, item.file_name)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      title={`Download ${item.title}`}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
                      onClick={() => handleFileDownload(item.id, buildDocFilename(String(item.title || 'Certificate').replace(/\s+/g, '_')), item.mime_type, item.file_name)}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {(canEditOwnProfile || canEditWorkInfo) && (
          <div className="mt-6 border-t border-slate-200 pt-6">
            <p className="text-sm font-medium text-slate-900">Add a qualification</p>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <FieldLabel>Qualification</FieldLabel>
                <SelectInput
                  value={educationForm.qualification || ''}
                  onChange={(event) => setEducationForm((current) => ({ ...current, qualification: event.target.value }))}
                >
                  <option value="">Select qualification</option>
                  {QUALIFICATION_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </SelectInput>
              </div>
              <div>
                <FieldLabel>Certificate</FieldLabel>
                <input
                  type="file"
                  className="block min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  onChange={(event) => setEducationForm((current) => ({ ...current, certificate_file: event.target.files?.[0] || null }))}
                />
              </div>
            </div>
            <div className="mt-4">
              <Button
                onClick={() => saveEducationMutation.mutate()}
                disabled={saveEducationMutation.isPending || !educationForm.qualification}
              >
                {saveEducationMutation.isPending ? 'Saving...' : 'Add Qualification'}
              </Button>
            </div>
          </div>
        )}
      </section>
      )}

      {/*
        Experience, shaped like Education so the page reads consistently. The
        records themselves are employee documents under one category — with no
        employer, dates or role captured there is no fact to hold beyond the
        document type, and a table for that would be an empty ceremony.
      */}
      {shows('experience') && (
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Award className="h-5 w-5 text-blue-600" />
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Experience</p>
        </div>
        <p className="mt-1 text-sm text-slate-500">Documents evidencing previous employment.</p>

        {experienceDocuments.length > 0 ? (
          <div className="mt-5 space-y-3">
            {experienceDocuments.map((item: any) => (
              <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-950">{item.title}</p>
                    <p className="text-sm text-slate-500">{item.file_name}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isPreviewable(item.mime_type, item.file_name) && (
                      <button
                        type="button"
                        title={`View ${item.title}`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
                        onClick={() => handleFilePreview(item.id, item.mime_type, item.file_name)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      title={`Download ${item.title}`}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
                      onClick={() => handleFileDownload(item.id, buildDocFilename(String(item.title || 'Experience').replace(/\s+/g, '_')), item.mime_type, item.file_name)}
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
            No experience documents on file.
          </p>
        )}

        {(canEditOwnProfile || canEditWorkInfo) && (
          <div className="mt-6 border-t border-slate-200 pt-6">
            <p className="text-sm font-medium text-slate-900">Add an experience document</p>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <FieldLabel>Document type</FieldLabel>
                <SelectInput
                  value={experienceForm.title || ''}
                  onChange={(event) => setExperienceForm((current) => ({ ...current, title: event.target.value }))}
                >
                  <option value="">Select document type</option>
                  {EXPERIENCE_DOCUMENT_TYPES.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </SelectInput>
              </div>
              <div>
                <FieldLabel>Document</FieldLabel>
                <input
                  type="file"
                  className="block min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  onChange={(event) => setExperienceForm((current) => ({ ...current, file: event.target.files?.[0] || null }))}
                />
              </div>
            </div>
            <div className="mt-4">
              <Button
                onClick={() => saveExperienceMutation.mutate()}
                disabled={saveExperienceMutation.isPending || !experienceForm.title || !experienceForm.file}
              >
                {saveExperienceMutation.isPending ? 'Uploading...' : 'Add Experience Document'}
              </Button>
            </div>
          </div>
        )}
      </section>
      )}

      {hasPayrollFeature && shows('bank') && (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-blue-600" />
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Bank Account Details</p>
          </div>
          <p className="mt-1 text-sm text-slate-500">Add bank account for salary payouts.</p>

          {data.bank_accounts?.length > 0 && (
            <div className="mt-5 space-y-3">
              {data.bank_accounts.map((item: any) => (
                <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-slate-950">{item.bank_name || 'Bank Account'}</p>
                      <p className="text-sm text-slate-500">Account: {item.account_number}</p>
                      <p className="text-sm text-slate-500">IFSC: {item.ifsc_swift}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {item.is_default && (
                        <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                          Default
                        </span>
                      )}
                      {item.document?.id && (
                        <>
                          {isPreviewable(item.document.mime_type, item.document.file_name) && (
                            <button
                              type="button"
                              title={`View ${item.bank_name || 'bank'} proof`}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
                              onClick={() => handleFilePreview(item.document.id, item.document.mime_type, item.document.file_name)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            title={`Download ${item.bank_name || 'bank'} proof`}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
                            onClick={() => handleFileDownload(item.document.id, buildDocFilename(`${item.bank_name || 'Bank'}_Proof`), item.document.mime_type, item.document.file_name)}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {(canEditOwnProfile || canEditWorkInfo) && (
            <div className="mt-6 border-t border-slate-200 pt-6">
              <p className="text-sm font-medium text-slate-900">Add New Bank Account</p>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]">
                <div>
                  <FieldLabel>Bank Name</FieldLabel>
                  <TextInput
                    value={bankForm.bank_name || ''}
                    onChange={(event) => setBankForm((current) => ({ ...current, bank_name: event.target.value }))}
                    placeholder="e.g., State Bank of India"
                  />
                </div>
                <div>
                  <FieldLabel>Account Number</FieldLabel>
                  <TextInput
                    value={bankForm.account_number || ''}
                    onChange={(event) => setBankForm((current) => ({ ...current, account_number: event.target.value }))}
                    placeholder="Enter account number"
                  />
                </div>
                <div>
                  <FieldLabel>IFSC Code</FieldLabel>
                  <TextInput
                    value={bankForm.ifsc_swift || ''}
                    onChange={(event) => setBankForm((current) => ({ ...current, ifsc_swift: event.target.value }))}
                    placeholder="e.g., SBIN0001234"
                  />
                </div>
                <div>
                  <FieldLabel>Branch</FieldLabel>
                  <TextInput
                    value={bankForm.branch || ''}
                    onChange={(event) => setBankForm((current) => ({ ...current, branch: event.target.value }))}
                    placeholder="Branch name"
                  />
                </div>
                <div>
                  <FieldLabel>Account Type</FieldLabel>
                  <SelectInput
                    value={bankForm.account_type || ''}
                    onChange={(event) => setBankForm((current) => ({ ...current, account_type: event.target.value }))}
                  >
                    <option value="">Select type</option>
                    <option value="savings">Savings</option>
                    <option value="current">Current</option>
                  </SelectInput>
                </div>
                <div>
                  <FieldLabel>Proof Document (Optional)</FieldLabel>
                  <input
                    type="file"
                    className="block min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    onChange={(event) => setBankForm((current) => ({ ...current, proof_file: event.target.files?.[0] || null }))}
                  />
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_default"
                  checked={bankForm.is_default}
                  onChange={(event) => setBankForm((current) => ({ ...current, is_default: event.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                <label htmlFor="is_default" className="text-sm text-slate-700">Set as default account</label>
              </div>
              <div className="mt-4">
                <Button
                  onClick={() => saveBankMutation.mutate()}
                  disabled={saveBankMutation.isPending || !bankForm.account_number || !bankForm.ifsc_swift}
                >
                  {saveBankMutation.isPending ? 'Saving...' : 'Add Bank Account'}
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {hasPayrollFeature && shows('documents') && (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-blue-600" />
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-700">Documents</p>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {selfService
              ? 'Documents on your record. Ask HR to add or replace anything here.'
              : 'Documents on this record. They are filed by the section each belongs to — Government IDs, Bank, Education, Experience.'}
          </p>

          {generalDocuments.length > 0 && (
            <div className="mt-5 space-y-3">
              {generalDocuments.map((item: any) => (
                <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-slate-950">{item.title}</p>
                        {/*
                          Stated on the row, not buried in an edit screen. HR
                          needs to see at a glance which of these the employee
                          can read — the difference between an offer letter and
                          a warning letter is not visible from the title.

                          Absent on the employee's own panel: they are looking
                          at the document, so labelling it "internal" there
                          answers a question nobody asked and contradicts the
                          evidence in front of them.
                        */}
                        {selfService ? null : item.visible_to_employee ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                            Shared
                          </span>
                        ) : (
                          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                            Internal
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-500">{item.category} • {item.file_name}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {isPreviewable(item.mime_type, item.file_name) && (
                        <button
                          type="button"
                          title={`View ${item.title}`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
                          onClick={() => handleFilePreview(item.id, item.mime_type, item.file_name)}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        title={`Download ${item.title}`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
                        onClick={() => handleFileDownload(item.id, buildDocFilename(item.title || item.category || 'document'), item.mime_type, item.file_name)}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/*
            There is no upload form here, deliberately.

            Every category it offered had a section of its own by the end:
            Identity and Address Proof duplicated Government IDs, where a PAN or
            an Aadhaar is recorded WITH its proof and the checklist can tell one
            from the other. Education and Experience had already been removed
            for the same reason. What was left filed a scan under a free-text
            title next to a structured record of the same fact, and an admin had
            to guess which of the two places was the real one.

            The list above still shows everything on the record, whichever
            section put it there.
          */}

          {/*
            An empty state, because the upload form used to occupy this space.
            Without it the section renders as a bare heading over nothing, which
            reads as a page that failed to load rather than a record with no
            general documents on it yet.
          */}
          {generalDocuments.length === 0 && (
            <p className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
              No general documents on file. Anything added under Government IDs,
              Bank, Education or Experience appears in its own section above.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
