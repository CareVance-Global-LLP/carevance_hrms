import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EmployeeDetailsSection from './EmployeeDetailsSection';
import { renderWithProviders } from '@/test/renderWithProviders';

/*
 * Coverage for the two props that let Settings > Profile reuse this component:
 * `sections`, which narrows what renders, and `selfService`, which swaps the
 * admin-only /employees/{id}/* endpoints for the /me/* ones an employee is
 * actually allowed to call.
 *
 * Both matter for reasons that are not cosmetic. Rendering the personal block
 * in Profile would duplicate a card that pane already owns, and calling the
 * admin endpoints as an employee is a guaranteed 403.
 */

const mocks = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  getRecords: vi.fn(),
  saveBankAccount: vi.fn(),
  mySaveBankAccount: vi.fn(),
  uploadDocument: vi.fn(),
  myUploadDocument: vi.fn(),
  saveEducation: vi.fn(),
  mySaveEducation: vi.fn(),
  deleteEducation: vi.fn(),
  myDeleteEducation: vi.fn(),
}));

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  employeeWorkspaceApi: {
    getWorkspace: mocks.getWorkspace,
    updateProfile: vi.fn(),
    updateWorkInfo: vi.fn(),
    saveGovernmentId: vi.fn(),
    saveEducation: mocks.saveEducation,
    deleteEducation: mocks.deleteEducation,
    saveBankAccount: mocks.saveBankAccount,
    uploadDocument: mocks.uploadDocument,
    downloadDocument: vi.fn(),
  },
  myEmployeeRecordApi: {
    getRecords: mocks.getRecords,
    saveGovernmentId: vi.fn(),
    saveEducation: mocks.mySaveEducation,
    deleteEducation: mocks.myDeleteEducation,
    saveBankAccount: mocks.mySaveBankAccount,
    uploadDocument: mocks.myUploadDocument,
    downloadDocument: vi.fn(),
  },
  groupApi: { getAll: vi.fn().mockResolvedValue({ data: [] }) },
}));

// Bank and Documents are gated on the payroll plan feature, which the
// component reads through usePlan rather than the auth context.
vi.mock('@/hooks/usePlan', () => ({
  usePlan: () => ({ hasFeature: () => true }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 7, name: 'Ava', role: 'employee' },
    organization: { id: 1, name: 'Acme' },
    hasFeature: () => true,
  }),
}));

const workspacePayload = {
  employee: { id: 7, name: 'Ava Employee', email: 'ava@acme.in' },
  about: { first_name: 'Ava', last_name: 'Employee' },
  work_info: { employee_code: 'EMP-007' },
  government_ids: [],
  educations: [],
  bank_accounts: [],
  documents: [],
  attendance: {},
  leave: {},
  activity: [],
};

const selfServicePayload = {
  employee: { id: 7, name: 'Ava Employee', email: 'ava@acme.in' },
  government_ids: [],
  bank_accounts: [],
  documents: [],
};

describe('EmployeeDetailsSection — the sections prop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorkspace.mockResolvedValue({ data: workspacePayload });
    mocks.getRecords.mockResolvedValue({ data: selfServicePayload });
  });

  it('renders every block by default, so existing callers are unaffected', async () => {
    renderWithProviders(<EmployeeDetailsSection userId={7} editable />);

    expect(await screen.findByText('Personal Details')).toBeInTheDocument();
    expect(screen.getByText('Work Information')).toBeInTheDocument();
    expect(screen.getByText('Government IDs')).toBeInTheDocument();
    expect(screen.getByText('Bank Account Details')).toBeInTheDocument();
  });

  it('renders only what was asked for', async () => {
    renderWithProviders(
      <EmployeeDetailsSection userId={7} editable sections={['government', 'bank', 'documents']} />
    );

    expect(await screen.findByText('Government IDs')).toBeInTheDocument();
    expect(screen.getByText('Bank Account Details')).toBeInTheDocument();
    expect(screen.getByText('Documents')).toBeInTheDocument();

    // Profile already owns a Personal details card; work info and education are
    // not the employee's to edit.
    expect(screen.queryByText('Personal Details')).not.toBeInTheDocument();
    expect(screen.queryByText('Work Information')).not.toBeInTheDocument();
    expect(screen.queryByText('Education')).not.toBeInTheDocument();
  });
});

describe('EmployeeDetailsSection — the selfService prop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorkspace.mockResolvedValue({ data: workspacePayload });
    mocks.getRecords.mockResolvedValue({ data: selfServicePayload });
  });

  it('reads the admin workspace endpoint by default', async () => {
    renderWithProviders(<EmployeeDetailsSection userId={7} editable />);

    await waitFor(() => expect(mocks.getWorkspace).toHaveBeenCalled());
    expect(mocks.getRecords).not.toHaveBeenCalled();
  });

  it('reads the /me endpoint instead when self-service', async () => {
    // Calling the admin route as an employee is a guaranteed 403 — it is gated
    // on role:admin,manager and takes somebody's id.
    renderWithProviders(
      <EmployeeDetailsSection userId={7} editable selfService sections={['bank']} />
    );

    await waitFor(() => expect(mocks.getRecords).toHaveBeenCalled());
    expect(mocks.getWorkspace).not.toHaveBeenCalled();
  });

  it('still renders the bank block from the narrower payload', async () => {
    // The self-service read returns a strict subset of the workspace shape, so
    // the section bodies need no mapping layer.
    renderWithProviders(
      <EmployeeDetailsSection userId={7} editable selfService sections={['bank']} />
    );

    expect(await screen.findByText('Bank Account Details')).toBeInTheDocument();
  });
});

/** One of EXPERIENCE_DOCUMENT_TYPES; the selected type becomes the title. */
const EXPERIENCE_DOCUMENT_TYPE = 'Relieving Letter';

describe('EmployeeDetailsSection — uploading a document', () => {
  /*
   * The bug this pins: a mutation built a FormData and passed it to the upload
   * client as `formData as any`. That client assembles its OWN FormData from
   * `data.title`, `data.category` and `data.file` — every one of which is
   * undefined on a FormData instance — so the request posted the literal string
   * "undefined" as the file and the server rejected it. The `as any` is what
   * stopped TypeScript from noticing.
   *
   * Asserting the SHAPE handed to the client is the only thing that catches it;
   * a FormData and a plain object both satisfy a mock call count.
   *
   * Aimed at the Experience upload because the generic Documents form is gone —
   * its categories duplicated Government IDs — but the hazard is a property of
   * every remaining upload path, not of the form that was removed.
   */
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorkspace.mockResolvedValue({ data: workspacePayload });
    mocks.getRecords.mockResolvedValue({ data: selfServicePayload });
    mocks.uploadDocument.mockResolvedValue({ data: {} });
    mocks.myUploadDocument.mockResolvedValue({ data: {} });
  });

  it('hands the admin client the fields, not a FormData', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EmployeeDetailsSection userId={7} editable sections={['experience']} />);

    const file = new File(['x'], 'relieving.pdf', { type: 'application/pdf' });

    await screen.findByText(/add an experience document/i);

    // SelectInput is a button-and-listbox dropdown, not a native select, so the
    // type is chosen by opening it and clicking the option.
    await user.click(screen.getByRole('button', { name: /select document type/i }));
    await user.click(await screen.findByRole('option', { name: EXPERIENCE_DOCUMENT_TYPE }));

    const fileInputs = document.querySelectorAll('input[type="file"]');
    await user.upload(fileInputs[fileInputs.length - 1] as HTMLInputElement, file);
    await user.click(screen.getByRole('button', { name: /add experience document/i }));

    await waitFor(() => expect(mocks.uploadDocument).toHaveBeenCalled());
    const payload = mocks.uploadDocument.mock.calls[0][1];

    expect(payload).not.toBeInstanceOf(FormData);
    expect(payload.title).toBe(EXPERIENCE_DOCUMENT_TYPE);
    expect(payload.file).toBe(file);
  });
});

describe('EmployeeDetailsSection — the Documents section files nothing itself', () => {
  /*
   * There is no upload form here for anybody now, admin included.
   *
   * Every category it offered ended up with a section of its own: Identity and
   * Address Proof duplicated Government IDs, where an ID is recorded WITH its
   * proof and the onboarding checklist can tell a PAN from an Aadhaar.
   * Education and Experience had already gone the same way. Two places to file
   * the same fact means an admin has to guess which one is real.
   */
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorkspace.mockResolvedValue({ data: workspacePayload });
    mocks.getRecords.mockResolvedValue({ data: selfServicePayload });
    mocks.uploadDocument.mockResolvedValue({ data: {} });
    mocks.myUploadDocument.mockResolvedValue({ data: {} });
  });

  it('offers no upload form on your own panel', async () => {
    renderWithProviders(
      <EmployeeDetailsSection userId={7} editable selfService sections={['documents']} />
    );

    await screen.findByText(/documents on your record/i);

    expect(screen.queryByText(/upload new document/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^upload document$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/share with this employee/i)).not.toBeInTheDocument();
  });

  it('offers none to an admin looking at that person either', async () => {
    renderWithProviders(<EmployeeDetailsSection userId={7} editable sections={['documents']} />);

    await screen.findByText(/documents on this record/i);

    expect(screen.queryByText(/upload new document/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^upload document$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/share with this employee/i)).not.toBeInTheDocument();
  });
});

describe('EmployeeDetailsSection — qualifications', () => {
  /*
   * Education is editable from the employee's own panel, which reverses the
   * note on the admin education routes about a person not attesting to their
   * own certificate. Deliberate: a joiner recording their own degree is how
   * onboarding runs, and HR still verifies it.
   *
   * The routing is what these pin. Calling the admin endpoint as an employee is
   * a 403 the mutation would surface as a red banner, so getting this wrong
   * looks like "adding a qualification is broken".
   */
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorkspace.mockResolvedValue({ data: workspacePayload });
    mocks.getRecords.mockResolvedValue({ data: selfServicePayload });
    mocks.saveEducation.mockResolvedValue({ data: {} });
    mocks.mySaveEducation.mockResolvedValue({ data: {} });
  });

  it('saves through the /me endpoint on your own panel', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <EmployeeDetailsSection userId={7} editable selfService sections={['education']} />
    );

    await user.click((await screen.findAllByText('Select qualification'))[0]);
    await user.click(await screen.findByRole('option', { name: 'Diploma' }));
    await user.click(screen.getByRole('button', { name: /add qualification/i }));

    await waitFor(() => expect(mocks.mySaveEducation).toHaveBeenCalled());
    expect(mocks.saveEducation).not.toHaveBeenCalled();
    // One argument, no id: the /me route addresses nobody, which is what makes
    // it impossible to point at another person.
    expect(mocks.mySaveEducation.mock.calls[0][0].qualification).toBe('Diploma');
  });

  it('saves through the admin endpoint when somebody else is looking', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EmployeeDetailsSection userId={7} editable sections={['education']} />);

    await user.click((await screen.findAllByText('Select qualification'))[0]);
    await user.click(await screen.findByRole('option', { name: 'Diploma' }));
    await user.click(screen.getByRole('button', { name: /add qualification/i }));

    await waitFor(() => expect(mocks.saveEducation).toHaveBeenCalled());
    expect(mocks.mySaveEducation).not.toHaveBeenCalled();
    // Addressed by id, which is exactly what the employee may not do. A string
    // because the backend resolves either an employee code or a numeric id.
    expect(mocks.saveEducation.mock.calls[0][0]).toBe('7');
  });
});
