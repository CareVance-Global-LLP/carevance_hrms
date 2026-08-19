import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Download, Plus, History, Loader2, ArrowLeft, AlertCircle, CheckCircle2, Upload, Send, CalendarClock, HelpCircle, Check } from 'lucide-react';
import { payrollApi } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import MetricCard from '@/components/dashboard/MetricCard';
import { SelectInput, FieldLabel } from '@/components/ui/FormField';
import { PageLoadingState, PageEmptyState } from '@/components/ui/PageState';
import InfoTooltip from '@/components/ui/InfoTooltip';
import HowItWorksCard from './HowItWorksCard';
import ModuleHeader from './ModuleHeader';
import { useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/dialog/Modal';
import type { PayGroupFilingDetail } from '@/types';

import UploadForm16Modal from './UploadForm16Modal';
import { mergeCatalogueAvailability } from './filingAvailability';

type ComplianceStatus = 'ready' | 'reference_only' | 'needs_external_input' | 'not_configured' | 'source_data_only' | 'unavailable';

const COMPLIANCE_BADGE: Record<ComplianceStatus, { label: string; className: string }> = {
  ready: { label: 'Filing-ready', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  reference_only: { label: 'Reference only — manual portal entry required', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  source_data_only: { label: 'Source data only — needs NSDL RPU', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  needs_external_input: { label: 'Needs external input — incomplete without outside data', className: 'bg-orange-50 text-orange-700 border-orange-200' },
  not_configured: { label: 'Not configured for your state', className: 'bg-rose-50 text-rose-700 border-rose-200' },
  // Distinct from not_configured on purpose: that badge says "for your
  // state", which would be an untrue explanation for a form whose statutory
  // template has not been written for anybody.
  unavailable: { label: 'Not available yet', className: 'bg-slate-100 text-slate-600 border-slate-300' },
};

const DUE_DATE_KEYS: Record<string, string> = {
  pf_ecr: 'pf_ecr',
  esi_challan: 'esi',
  form_24q: 'tds',
  pt_return: 'pt',
  lwf_return: 'lwf',
  bonus_form_c: 'bonus',
  bonus_form_d: 'bonus',
};

type FilingDisplayStatus = 'generated' | 'filed' | 'pending' | 'not_due';

const FILING_DISPLAY: Record<FilingDisplayStatus, { label: string; className: string }> = {
  generated: { label: 'Generated', className: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  filed: { label: 'Filed', className: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  pending: { label: 'Pending', className: 'bg-amber-50 text-amber-700 border border-amber-200' },
  not_due: { label: 'Not Due', className: 'bg-slate-100 text-slate-500 border border-slate-200' },
};

const FILING_CARDS: Array<{
  key: string;
  label: string;
  displayStatus: FilingDisplayStatus;
  periodInfo: string;
  needsRun?: boolean;
  needsState?: boolean;
  needsBonusPercent?: boolean;
  complianceStatus: ComplianceStatus;
  tooltip: string;
  pattern: 'A' | 'B' | 'C';
  nextAction: string;
  deadlineRule: string;
}> = [
  {
    key: 'pf_ecr', label: 'PF — ECR', displayStatus: 'generated', periodInfo: 'Oct 2025 · Due: 15 Nov', needsRun: true,
    complianceStatus: 'ready', pattern: 'A',
    nextAction: 'Download → Upload to EPFO portal → Mark Filed',
    deadlineRule: '15th of the next month',
    tooltip: 'Electronic Challan cum Return — monthly PF contribution filing with EPFO. Generated in EPFO\'s actual ECR text format (UAN, wages, PF/EPS splits, 11-column ||-delimited). Upload-ready. Due by the 15th of the next month.',
  },
  {
    key: 'esi_challan', label: 'ESI — Challan', displayStatus: 'filed', periodInfo: 'Oct 2025 · Paid: 12 Nov', needsRun: true,
    complianceStatus: 'reference_only', pattern: 'A',
    nextAction: 'Download → Upload to ESIC portal → Mark Filed',
    deadlineRule: '15th of the next month',
    tooltip: 'An Excel (.xls) template matching the ESIC portal upload format with columns: IP Number, IP Name, No of Days, Total Monthly Wages, Reason Code, Last Working Day. Employer Code is entered separately on the portal.',
  },
  {
    key: 'form_24q', label: 'TDS — 24Q', displayStatus: 'pending', periodInfo: 'Q2 · Due: 7 Nov', needsRun: true,
    complianceStatus: 'reference_only', pattern: 'B',
    nextAction: 'Download → Upload via NSDL RPU → Mark Filed',
    deadlineRule: '15 days after quarter end',
    tooltip: 'Generated in NSDL FVU format — a ^-delimited ASCII .txt file with \\r\\n line endings, containing FH/BH/CD/DD/SD record types. Ready for upload to TDS-CPC after validation.',
  },
  {
    key: 'form_16', label: 'Form 16', displayStatus: 'not_due', periodInfo: 'FY-end only · Jun 2026', needsRun: false,
    complianceStatus: 'needs_external_input', pattern: 'C',
    nextAction: 'Generate Part B → Download TRACES Part A → Attach',
    deadlineRule: '15 June (annual)',
    tooltip: 'Form 16 Part B (Salary Statement) — generated as a real PDF from the employee\'s aggregated FY payroll. Part A (with the TRACES certificate number) must be downloaded from TRACES after quarterly TDS filing and attached separately; this system cannot mint that number.',
  },
  {
    key: 'pt_return', label: 'PT', displayStatus: 'filed', periodInfo: 'Oct 2025 · Gujarat', needsRun: true, needsState: true,
    complianceStatus: 'reference_only', pattern: 'A',
    nextAction: 'Download → Upload to state tax portal → Mark Filed',
    deadlineRule: 'Varies by state',
    tooltip: 'State-level Professional Tax contribution summary for manual entry / reference. The actual PT payment/return is made on the state commercial tax department portal. Due dates vary by state.',
  },
  {
    key: 'lwf_return', label: 'LWF', displayStatus: 'not_due', periodInfo: 'Dec 2025 · Gujarat', needsRun: true, needsState: true,
    complianceStatus: 'not_configured', pattern: 'A',
    nextAction: 'Select state → Download → Upload to state portal → Mark Filed',
    deadlineRule: 'State-dependent',
    tooltip: 'Labour Welfare Fund is a state subject with no universal formula. Pick your state to generate; if your state\'s rate is not configured, you\'ll see a clear "Not configured" message instead of a wrong number. Periodicity varies (monthly / bi-annual) by state.',
  },
  {
    key: 'bonus_form_c', label: 'Bonus — Form C', displayStatus: 'not_due', periodInfo: 'Annual · FY-end', needsRun: true, needsBonusPercent: true,
    complianceStatus: 'not_configured', pattern: 'B',
    nextAction: 'Download → Upload to portal → Mark Filed',
    deadlineRule: 'By 15 June (annual)',
    tooltip: 'Annual Return under the Payment of Bonus Act — Form C. Requires a bonus percentage (8.33%–20%) configured in Payroll Settings. Generated as a text summary of annual wages and bonus amounts.',
  },
  {
    key: 'bonus_form_d', label: 'Bonus — Form D', displayStatus: 'not_due', periodInfo: 'Annual · FY-end', needsRun: true, needsBonusPercent: true,
    complianceStatus: 'not_configured', pattern: 'B',
    nextAction: 'Download → Maintain as employer record',
    deadlineRule: 'By 15 June (annual)',
    tooltip: 'Register of Bonus Paid/Claimable under the Payment of Bonus Act — Form D. Requires a bonus percentage (8.33%–20%) configured in Payroll Settings. A statutory record maintained by the employer.',
  },
  {
    key: 'form_19', label: 'Form 19', displayStatus: 'not_due', periodInfo: 'On termination', needsRun: true,
    complianceStatus: 'ready', pattern: 'A',
    nextAction: 'Download → File with employer records',
    deadlineRule: 'On termination',
    tooltip: 'Final Settlement statement for employees who have left the organization. Includes settlement amount, gratuity, and exit details.',
  },
  {
    key: 'form_31', label: 'Form 31', displayStatus: 'not_due', periodInfo: 'On transfer', needsRun: true,
    complianceStatus: 'ready', pattern: 'A',
    nextAction: 'Download → File with employer records',
    deadlineRule: 'On transfer',
    tooltip: 'Transfer Application form for employees changing departments or locations. Includes transfer details and salary information.',
  },
  {
    key: 'form_1', label: 'Form 1', displayStatus: 'not_due', periodInfo: 'On joining', needsRun: true,
    complianceStatus: 'ready', pattern: 'A',
    nextAction: 'Download → File with employer records',
    deadlineRule: 'On joining',
    tooltip: 'Employer Registration form containing organization details, PAN, TAN, and statutory registration numbers.',
  },
  {
    key: 'form_2', label: 'Form 2', displayStatus: 'not_due', periodInfo: 'Monthly', needsRun: true,
    complianceStatus: 'ready', pattern: 'A',
    nextAction: 'Download → File with employer records',
    deadlineRule: 'Monthly',
    tooltip: 'Employee Registration form listing all active employees with their statutory details (PAN, UAN, ESI, joining date).',
  },
  {
    key: 'form_6', label: 'Form 6', displayStatus: 'not_due', periodInfo: 'Monthly', needsRun: true,
    complianceStatus: 'ready', pattern: 'A',
    nextAction: 'Download → File with employer records',
    deadlineRule: 'Monthly',
    tooltip: 'Monthly Return summarizing employee contributions (PF, ESI, TDS) for the payroll period.',
  },
  {
    key: 'eshram_registration', label: 'e-SHRAM', displayStatus: 'not_due', periodInfo: 'On joining', needsRun: true,
    complianceStatus: 'ready', pattern: 'A',
    nextAction: 'Download → Upload to e-SHRAM portal',
    deadlineRule: 'On joining',
    tooltip: 'e-SHRAM registration details for the organization and its employees, submitted to the ESIC portal.',
  },
  {
    key: 'uan_activation', label: 'UAN Activation', displayStatus: 'not_due', periodInfo: 'On joining', needsRun: true,
    complianceStatus: 'ready', pattern: 'A',
    nextAction: 'Download → Upload to UAN portal',
    deadlineRule: 'On joining',
    tooltip: 'UAN activation status for employees — tracks which employees have activated their Universal Account Numbers.',
  },
  {
    key: 'se_registration', label: 'S&E Registration', displayStatus: 'not_due', periodInfo: 'Annual', needsRun: true,
    complianceStatus: 'ready', pattern: 'A',
    nextAction: 'Download → File with employer records',
    deadlineRule: 'Annual',
    tooltip: 'State & Employer registration details for statutory compliance reporting.',
  },
  {
    key: 'shram_card_registration', label: 'Shram Card', displayStatus: 'not_due', periodInfo: 'On joining', needsRun: true,
    complianceStatus: 'ready', pattern: 'A',
    nextAction: 'Download → Upload to labour portal',
    deadlineRule: 'On joining',
    tooltip: 'Shram Card registration details for employees, submitted to the labour department portal.',
  },
  {
    key: 'form_124', label: 'Form 124', displayStatus: 'not_due', periodInfo: 'Monthly', needsRun: true,
    complianceStatus: 'ready', pattern: 'A',
    nextAction: 'Download → File with employer records',
    deadlineRule: 'Monthly',
    tooltip: 'Form 124 — monthly statutory return with employee salary and TDS details.',
  },
  {
    key: 'full_ecr', label: 'Full ECR', displayStatus: 'not_due', periodInfo: 'Monthly', needsRun: true,
    complianceStatus: 'ready', pattern: 'A',
    nextAction: 'Download → Upload to EPFO portal → Mark Filed',
    deadlineRule: '15th of the next month',
    tooltip: 'Full Electronic Challan cum Return with extended employee details (UAN, bank account, designation). Generated in EPFO\'s ||-delimited text format.',
  },
];

const PATTERN_BADGE: Record<'A' | 'B' | 'C', { label: string; className: string; borderColor: string }> = {
  A: { label: 'Pattern A: Upload-ready', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', borderColor: 'border-emerald-500' },
  B: { label: 'Pattern B: Reference', className: 'bg-amber-50 text-amber-700 border-amber-200', borderColor: 'border-amber-500' },
  C: { label: 'Pattern C: External input', className: 'bg-orange-50 text-orange-700 border-orange-200', borderColor: 'border-orange-500' },
};

type FilingGuidance = {
  whatIsThis: string;
  whenToUse: string[];
  howItFlows: Array<{ step: number; label: string; desc?: string }>;
  commonMistakes: string[];
};

const FILING_GUIDANCE: Record<string, FilingGuidance> = {
  pf_ecr: {
    whatIsThis: 'Electronic Challan cum Return — monthly PF contribution filing with EPFO. Generated in EPFO\'s exact ECR text format (UAN, wages, PF/EPS splits, 11-column ||-delimited). This file is upload-ready to the EPFO portal.',
    whenToUse: ['Monthly, for the previous month', 'Due by the 15th of the next month', 'After the payroll run is locked and approved'],
    howItFlows: [
      { step: 1, label: 'Generate', desc: 'Click Generate to create the ECR file' },
      { step: 2, label: 'Download', desc: 'Download the .txt file' },
      { step: 3, label: 'Upload to EPFO', desc: 'Log in to the EPFO portal and upload the file' },
      { step: 4, label: 'Mark Filed', desc: 'Return here and click "Mark Filed" with the challan number' },
    ],
    commonMistakes: ['Generating from a draft run (must be locked first)', 'Missing UAN numbers for employees', 'Wrong wage type mapping'],
  },
  esi_challan: {
    whatIsThis: 'Monthly ESI contribution filing with ESIC. Generated as an Excel (.xls) template matching the ESIC portal upload format with columns: IP Number, IP Name, No of Days, Total Monthly Wages, Reason Code, Last Working Day. Employer Code is entered separately on the portal.',
    whenToUse: ['Monthly, for the previous month', 'Due by the 15th of the next month', 'After the payroll run is locked and approved'],
    howItFlows: [
      { step: 1, label: 'Generate', desc: 'Click Generate to create the ESI template' },
      { step: 2, label: 'Download', desc: 'Download the .xls file' },
      { step: 3, label: 'Upload to ESIC', desc: 'Log in to the ESIC portal and upload the template' },
      { step: 4, label: 'Mark Filed', desc: 'Return here and click "Mark Filed" with the challan number' },
    ],
    commonMistakes: ['Generating from a draft run', 'Missing ESI IP numbers for employees', 'Wrong employer code mapping'],
  },
  form_24q: {
    whatIsThis: 'Quarterly TDS return generated in NSDL FVU format — a ^-delimited ASCII .txt file with \\r\\n line endings, containing FH/BH/CD/DD/SD record types. This is source data ready for TDS-CPC upload after validation.',
    whenToUse: ['Quarterly (Q1: Apr–Jun, Q2: Jul–Sep, Q3: Oct–Dec, Q4: Jan–Mar)', 'Due 15 days after quarter end', 'After the payroll run is locked and approved'],
    howItFlows: [
      { step: 1, label: 'Generate', desc: 'Click Generate to create the 24Q file' },
      { step: 2, label: 'Validate', desc: 'Run through NSDL File Validation Utility (FVU)' },
      { step: 3, label: 'Upload to TDS-CPC', desc: 'Log in to TDS-CPC and upload the validated file' },
      { step: 4, label: 'Mark Filed', desc: 'Return here and click "Mark Filed" with the acknowledgment number' },
    ],
    commonMistakes: ['Treating the export as a ready-to-upload file (must be validated via FVU first)', 'Generating from a draft run', 'Wrong TAN or incorrect salary breakup'],
  },
  form_16: {
    whatIsThis: 'Form 16 Part B (Salary Statement) — generated as a real PDF from the employee\'s aggregated FY payroll. Part A (with the TRACES certificate number) must be downloaded from TRACES after quarterly TDS filing and attached separately; this system cannot mint that number.',
    whenToUse: ['Annually, after the financial year ends (Apr–Mar)', 'Due by 15 June following the FY', 'After all quarterly TDS returns are filed on TRACES'],
    howItFlows: [
      { step: 1, label: 'Generate Part B', desc: 'Select employee and FY, click Generate to create the PDF' },
      { step: 2, label: 'Download Part A', desc: 'Log in to TRACES and download Form 16 Part A with the certificate number' },
      { step: 3, label: 'Attach', desc: 'Combine Part A (TRACES) and Part B (this system) into one PDF' },
      { step: 4, label: 'Distribute', desc: 'Provide the combined PDF to the employee' },
    ],
    commonMistakes: ['Believing a self-assigned Form 16 certificate number is valid (only TRACES issues it)', 'Generating before the FY is complete', 'Missing Part A attachment'],
  },
  pt_return: {
    whatIsThis: 'State-level Professional Tax contribution summary for manual entry / reference. The actual PT payment/return is made on the state commercial tax department portal. Due dates vary by state.',
    whenToUse: ['Monthly, for the previous month', 'Due dates vary by state (typically 10th–15th of next month)', 'After the payroll run is locked and approved'],
    howItFlows: [
      { step: 1, label: 'Select state', desc: 'Choose your state to get the correct PT rules' },
      { step: 2, label: 'Generate', desc: 'Click Generate to create the PT summary' },
      { step: 3, label: 'Download', desc: 'Download the summary file' },
      { step: 4, label: 'Upload to portal', desc: 'Log in to your state tax portal and file the return' },
      { step: 5, label: 'Mark Filed', desc: 'Return here and click "Mark Filed" with the challan number' },
    ],
    commonMistakes: ['Generating from a draft run', 'Using the wrong state', 'Missing the state-specific due date'],
  },
  lwf_return: {
    whatIsThis: 'Labour Welfare Fund is a state subject with no universal formula. Pick your state to generate; if your state\'s rate is not configured, you\'ll see a clear "Not configured" message instead of a wrong number. Periodicity varies (monthly / bi-annual) by state.',
    whenToUse: ['When due for your configured state(s)', 'Periodicity varies by state (monthly or bi-annual)', 'After the payroll run is locked and approved'],
    howItFlows: [
      { step: 1, label: 'Select state', desc: 'Choose your state to get the correct LWF rules' },
      { step: 2, label: 'Generate', desc: 'Click Generate to create the LWF summary' },
      { step: 3, label: 'Download', desc: 'Download the summary file' },
      { step: 4, label: 'Upload to portal', desc: 'Log in to your state portal and file the return' },
      { step: 5, label: 'Mark Filed', desc: 'Return here and click "Mark Filed" with the challan number' },
    ],
    commonMistakes: ['Generating from a draft run', 'Using the wrong state', 'Missing state configuration in PayGroupSettings'],
  },
  bonus_form_c: {
    whatIsThis: 'Annual Return under the Payment of Bonus Act — Form C. Requires a bonus percentage (8.33%–20%) configured in Payroll Settings. Generated as a text summary of annual wages and bonus amounts.',
    whenToUse: ['Annually, after the financial year ends', 'Due by 15 June following the FY', 'After the payroll run is locked and approved'],
    howItFlows: [
      { step: 1, label: 'Configure bonus %', desc: 'Set the bonus percentage (8.33%–20%) in Payroll Settings' },
      { step: 2, label: 'Generate', desc: 'Click Generate to create Form C' },
      { step: 3, label: 'Download', desc: 'Download the file' },
      { step: 4, label: 'Upload to portal', desc: 'File with the labour department portal' },
      { step: 5, label: 'Mark Filed', desc: 'Return here and click "Mark Filed" with the challan number' },
    ],
    commonMistakes: ['Using the wrong bonus percentage', 'Generating from a draft run', 'Missing the annual deadline'],
  },
  bonus_form_d: {
    whatIsThis: 'Register of Bonus Paid/Claimable under the Payment of Bonus Act — Form D. Requires a bonus percentage (8.33%–20%) configured in Payroll Settings. A statutory record maintained by the employer.',
    whenToUse: ['Annually, after the financial year ends', 'Due by 15 June following the FY', 'After the payroll run is locked and approved'],
    howItFlows: [
      { step: 1, label: 'Configure bonus %', desc: 'Set the bonus percentage (8.33%–20%) in Payroll Settings' },
      { step: 2, label: 'Generate', desc: 'Click Generate to create Form D' },
      { step: 3, label: 'Download', desc: 'Download the file and maintain as an employer record' },
    ],
    commonMistakes: ['Using the wrong bonus percentage', 'Generating from a draft run', 'Not maintaining the record for inspection'],
  },
  form_19: {
    whatIsThis: 'Final Settlement statement for employees who have left the organization. Includes settlement amount, gratuity, and exit details.',
    whenToUse: ['On employee termination/resignation', 'After the final payroll run for the employee', 'After the payroll run is locked and approved'],
    howItFlows: [
      { step: 1, label: 'Generate', desc: 'Click Generate to create Form 19 for the terminated employee' },
      { step: 2, label: 'Download', desc: 'Download the file' },
      { step: 3, label: 'File', desc: 'Maintain as an employer record for inspection' },
    ],
    commonMistakes: ['Generating from a draft run', 'Missing gratuity calculation', 'Not retaining for inspection'],
  },
  form_31: {
    whatIsThis: 'Transfer Application form for employees changing departments or locations. Includes transfer details and salary information.',
    whenToUse: ['On employee transfer within the organization', 'After the payroll run is locked and approved'],
    howItFlows: [
      { step: 1, label: 'Generate', desc: 'Click Generate to create Form 31 for the transferred employee' },
      { step: 2, label: 'Download', desc: 'Download the file' },
      { step: 3, label: 'File', desc: 'Maintain as an employer record' },
    ],
    commonMistakes: ['Generating from a draft run', 'Missing transfer date', 'Not retaining for inspection'],
  },
  form_1: {
    whatIsThis: 'Employer Registration form containing organization details, PAN, TAN, and statutory registration numbers.',
    whenToUse: ['On initial setup or when registration details change', 'After the payroll run is locked and approved'],
    howItFlows: [
      { step: 1, label: 'Generate', desc: 'Click Generate to create Form 1' },
      { step: 2, label: 'Download', desc: 'Download the file' },
      { step: 3, label: 'File', desc: 'Maintain as an employer record' },
    ],
    commonMistakes: ['Generating from a draft run', 'Missing statutory registration numbers', 'Not updating when details change'],
  },
  form_2: {
    whatIsThis: 'Employee Registration form listing all active employees with their statutory details (PAN, UAN, ESI, joining date).',
    whenToUse: ['Monthly, for all active employees', 'After the payroll run is locked and approved'],
    howItFlows: [
      { step: 1, label: 'Generate', desc: 'Click Generate to create Form 2 for all active employees' },
      { step: 2, label: 'Download', desc: 'Download the file' },
      { step: 3, label: 'File', desc: 'Maintain as an employer record' },
    ],
    commonMistakes: ['Generating from a draft run', 'Missing statutory details for employees', 'Including inactive employees'],
  },
  form_6: {
    whatIsThis: 'Monthly Return summarizing employee contributions (PF, ESI, TDS) for the payroll period.',
    whenToUse: ['Monthly, for the previous month', 'After the payroll run is locked and approved'],
    howItFlows: [
      { step: 1, label: 'Generate', desc: 'Click Generate to create Form 6' },
      { step: 2, label: 'Download', desc: 'Download the file' },
      { step: 3, label: 'File', desc: 'Maintain as an employer record' },
    ],
    commonMistakes: ['Generating from a draft run', 'Missing contribution amounts', 'Including inactive employees'],
  },
  eshram_registration: {
    whatIsThis: 'e-SHRAM registration details for the organization and its employees, submitted to the ESIC portal.',
    whenToUse: ['On employee joining', 'After the payroll run is locked and approved'],
    howItFlows: [
      { step: 1, label: 'Generate', desc: 'Click Generate to create the e-SHRAM registration file' },
      { step: 2, label: 'Download', desc: 'Download the file' },
      { step: 3, label: 'Upload to portal', desc: 'Submit to the e-SHRAM portal' },
    ],
    commonMistakes: ['Generating from a draft run', 'Missing employee details', 'Not uploading to the portal'],
  },
  uan_activation: {
    whatIsThis: 'UAN activation status for employees — tracks which employees have activated their Universal Account Numbers.',
    whenToUse: ['On employee joining', 'After the payroll run is locked and approved'],
    howItFlows: [
      { step: 1, label: 'Generate', desc: 'Click Generate to create the UAN activation report' },
      { step: 2, label: 'Download', desc: 'Download the file' },
      { step: 3, label: 'Verify', desc: 'Check which employees have activated their UANs' },
    ],
    commonMistakes: ['Generating from a draft run', 'Missing UAN numbers for employees', 'Not following up on inactive UANs'],
  },
  se_registration: {
    whatIsThis: 'State & Employer registration details for statutory compliance reporting.',
    whenToUse: ['Annually or when registration details change', 'After the payroll run is locked and approved'],
    howItFlows: [
      { step: 1, label: 'Generate', desc: 'Click Generate to create the S&E registration file' },
      { step: 2, label: 'Download', desc: 'Download the file' },
      { step: 3, label: 'File', desc: 'Maintain as an employer record' },
    ],
    commonMistakes: ['Generating from a draft run', 'Missing registration details', 'Not updating when details change'],
  },
  shram_card_registration: {
    whatIsThis: 'Shram Card registration details for employees, submitted to the labour department portal.',
    whenToUse: ['On employee joining', 'After the payroll run is locked and approved'],
    howItFlows: [
      { step: 1, label: 'Generate', desc: 'Click Generate to create the Shram Card registration file' },
      { step: 2, label: 'Download', desc: 'Download the file' },
      { step: 3, label: 'Upload to portal', desc: 'Submit to the labour department portal' },
    ],
    commonMistakes: ['Generating from a draft run', 'Missing employee details', 'Not uploading to the portal'],
  },
  form_124: {
    whatIsThis: 'Form 124 — monthly statutory return with employee salary and TDS details.',
    whenToUse: ['Monthly, for the previous month', 'After the payroll run is locked and approved'],
    howItFlows: [
      { step: 1, label: 'Generate', desc: 'Click Generate to create Form 124' },
      { step: 2, label: 'Download', desc: 'Download the file' },
      { step: 3, label: 'File', desc: 'Maintain as an employer record' },
    ],
    commonMistakes: ['Generating from a draft run', 'Missing salary details', 'Including inactive employees'],
  },
  full_ecr: {
    whatIsThis: 'Full Electronic Challan cum Return with extended employee details (UAN, bank account, designation). Generated in EPFO\'s ||-delimited text format. Upload-ready to the EPFO portal.',
    whenToUse: ['Monthly, for the previous month', 'Due by the 15th of the next month', 'After the payroll run is locked and approved'],
    howItFlows: [
      { step: 1, label: 'Generate', desc: 'Click Generate to create the Full ECR file' },
      { step: 2, label: 'Download', desc: 'Download the .txt file' },
      { step: 3, label: 'Upload to EPFO', desc: 'Log in to the EPFO portal and upload the file' },
      { step: 4, label: 'Mark Filed', desc: 'Return here and click "Mark Filed" with the challan number' },
    ],
    commonMistakes: ['Generating from a draft run (must be locked first)', 'Missing UAN numbers for employees', 'Missing bank account details'],
  },
  form_12ba: {
    whatIsThis: 'Annual statement of perquisites paid to employees. Generated as a PDF from the employee\'s aggregated FY payroll data. Used alongside Form 16 for tax filing.',
    whenToUse: ['Annually, after the financial year ends', 'Due by 15 June following the FY', 'After the payroll run is locked and approved'],
    howItFlows: [
      { step: 1, label: 'Generate', desc: 'Select employee and FY, click Generate to create the PDF' },
      { step: 2, label: 'Download', desc: 'Download the file' },
      { step: 3, label: 'File', desc: 'Maintain as an employer record for inspection' },
    ],
    commonMistakes: ['Generating from a draft run', 'Missing perquisite details', 'Not retaining for inspection'],
  },
};

const STATES = [
  'maharashtra', 'karnataka', 'tamil_nadu', 'gujarat', 'west_bengal', 'delhi', 'haryana',
  'uttar_pradesh', 'telangana', 'andhra_pradesh', 'rajasthan', 'madhya_pradesh', 'punjab',
  'odisha', 'kerala', 'bihar', 'jharkhand', 'assam', 'goa',
];

const fmtState = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

type FilingStatus = 'draft' | 'generated' | 'submitted' | 'approved' | 'filed' | 'acknowledged' | 'error';

const STATUS_BADGE: Record<FilingStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  generated: 'bg-sky-50 text-sky-700',
  submitted: 'bg-amber-50 text-amber-700',
  approved: 'bg-violet-50 text-violet-700',
  filed: 'bg-blue-50 text-blue-700',
  acknowledged: 'bg-emerald-50 text-emerald-700',
  error: 'bg-rose-50 text-rose-700',
};

export default function FilingsDashboard() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const { organization } = useAuth();
  const organizationName = organization?.name || '';
  const [selectedRun, setSelectedRun] = useState<number | null>(null);
  const [ptState, setPtState] = useState<string>('');
  const [lwfState, setLwfState] = useState<string>('');
  const [bonusPercent, setBonusPercent] = useState<string>('8.33');
  const [form16EmployeeId, setForm16EmployeeId] = useState<number | null>(null);
  const [form16FinancialYear, setForm16FinancialYear] = useState<string>('2026-2027');
  const [activeTab, setActiveTab] = useState<'generate' | 'history' | 'form16' | 'upload-form16' | 'review'>('generate');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [markFiledFor, setMarkFiledFor] = useState<number | null>(null);
  const markFiledInputRef = useRef<HTMLInputElement>(null);
  const [ackInput, setAckInput] = useState<string>('');
  const [useActualState, _setUseActualState] = useState(false);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);

  const currentYear = new Date().getFullYear();
  const financialYears = Array.from({ length: 6 }, (_, i) => {
    const start = currentYear - i;
    return `${start}-${start + 1}`;
  });

  const { data: runs, isLoading: runsLoading } = useQuery({
    queryKey: ['payroll-runs'],
    queryFn: () => payrollApi.getPayrollRuns().then(r => r.data),
  });

  const { data: employees, isLoading: employeesLoading } = useQuery({
    queryKey: ['payroll-filing-employees'],
    queryFn: () => payrollApi.getEmployees().then(r => r.data),
  });

  const { data: settings } = useQuery({
    queryKey: ['payroll-settings'],
    queryFn: () => payrollApi.getPayrollSettings().then(r => r.data),
  });

  const { data: filingsData, isLoading: filingsLoading } = useQuery({
    queryKey: ['payroll-filings'],
    queryFn: () => payrollApi.listFilings().then((r) => r.data),
  });

  const { data: runValidationRaw } = useQuery({
    queryKey: ['payroll-filing-run-validate', selectedRun],
    queryFn: () => payrollApi.validateRun(selectedRun as number),
    enabled: !!selectedRun,
  });
  const runValidation = (runValidationRaw as any)?.data ?? runValidationRaw;

  const downloadMutation = useMutation({
    mutationFn: async (filing: { id: number; original_filename: string; type: string }) => {
      const response = await payrollApi.downloadFiling(filing.id);
      const isPdf = (filing.original_filename || '').toLowerCase().endsWith('.pdf');
      const blob = new Blob([response.data], { type: isPdf ? 'application/pdf' : 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filing.original_filename || `${filing.type}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      return filing;
    },
    onSuccess: (filing) => {
      show({ kind: 'success', message: `Downloaded ${filing.original_filename}`, durationMs: 3000 });
    },
    onError: (e: any) => {
      show({ kind: 'error', message: e?.message || 'Failed to download filing', durationMs: 4000 });
    },
  });

  const generateSingleMutation = useMutation({
    mutationFn: async ({ type, runId }: { type: string; runId: number }) => {
      const payGroupId = useActualState && selectedRunData?.pay_group_id ? selectedRunData.pay_group_id : null;
      const resp = (() => {
        switch (type) {
          case 'pf_ecr': return payrollApi.generatePfEcr(runId);
          case 'esi_challan': return payrollApi.generateEsiChallan(runId);
          case 'form_24q': return payrollApi.generateForm24Q(runId);
          case 'form_12ba': return payrollApi.generateForm12BA(runId);
          case 'lwf_return': return payrollApi.generateLwfReturn(runId, lwfState, payGroupId);
          case 'bonus_form_c': return payrollApi.generateBonusFormC(runId, parseFloat(bonusPercent));
          case 'bonus_form_d': return payrollApi.generateBonusFormD(runId, parseFloat(bonusPercent));
          case 'pt_return': return payrollApi.generatePtReturn(runId, ptState, payGroupId);
          case 'form_19': return payrollApi.generateForm19(runId);
          case 'form_31': return payrollApi.generateForm31(runId);
          case 'form_1': return payrollApi.generateForm1(runId);
          case 'form_2': return payrollApi.generateForm2(runId);
          case 'form_6': return payrollApi.generateForm6(runId);
          case 'eshram_registration': return payrollApi.generateEShramRegistration(runId);
          case 'uan_activation': return payrollApi.generateUanActivation(runId);
          case 'se_registration': return payrollApi.generateSeRegistration(runId);
          case 'shram_card_registration': return payrollApi.generateShramCardRegistration(runId);
          case 'form_124': return payrollApi.generateForm124(runId);
          case 'full_ecr': return payrollApi.generateFullEcr(runId);
          default: throw new Error('Unknown filing type');
        }
      })();
      return (await resp).data;
    },
    onSuccess: (data: any, vars) => {
      queryClient.invalidateQueries({ queryKey: ['payroll-filings'] });
      if (!data?.file_path) {
        show({ kind: 'error', message: `${vars.type.replace(/_/g, ' ').toUpperCase()} was generated but produced no downloadable file. Please report this.`, durationMs: 6000 });
        return;
      }
      show({ kind: 'success', message: `${vars.type.replace(/_/g, ' ').toUpperCase()} generated successfully`, durationMs: 4000 });
    },
    onError: (e: any) => {
      show({ kind: 'error', message: e?.response?.data?.message || e?.message || 'Failed to generate filing', durationMs: 5000 });
    },
  });

    const generateAllMutation = useMutation({
      mutationFn: (runId: number) => {
        const payGroupId = useActualState && selectedRunData?.pay_group_id ? selectedRunData.pay_group_id : null;
        return payrollApi.generateAllFilings(runId, payGroupId);
      },
      onSuccess: (data: any) => {
        queryClient.invalidateQueries({ queryKey: ['payroll-filings'] });
        show({ kind: 'success', message: 'All filings generated.', durationMs: 4000 });
      },
      onError: (e: any) => {
        show({ kind: 'error', message: e?.response?.data?.message || e?.message || 'Failed to generate filings', durationMs: 5000 });
      },
    });

  const generateForm16Mutation = useMutation({
    mutationFn: ({ userId, financialYear }: { userId: number; financialYear: string }) =>
      payrollApi.generateForm16(userId, financialYear).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-filings'] });
      show({ kind: 'success', message: 'Form 16 generated successfully', durationMs: 4000 });
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.message || e?.message || 'Failed to generate Form 16';
      show({ kind: 'error', message: msg, durationMs: 6000 });
    },
  });

  // Mark filed (record ack number)
  const markFiledMutation = useMutation({
    mutationFn: ({ id, ack }: { id: number; ack: string }) => payrollApi.markFilingFiled(id, ack, 'paid'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-filings'] });
      setMarkFiledFor(null);
      setAckInput('');
      show({ kind: 'success', message: 'Recorded as filed.', durationMs: 4000 });
    },
    onError: (e: any) => show({ kind: 'error', message: e?.response?.data?.message || 'Failed to mark filed', durationMs: 4000 }),
  });

  const portalInfoMutation = useMutation({
    mutationFn: (id: number) => payrollApi.getPortalInfo(id),
    onSuccess: (resp: any) => {
      const info = resp?.data ?? resp;
      if (info?.url) {
        window.open(info.url, '_blank', 'noopener,noreferrer');
        show({ kind: 'info', message: `${info.portal}: open the portal, then upload/download the exact file from History.`, durationMs: 6000 });
      } else {
        show({ kind: 'info', message: info?.instructions || 'No portal upload required for this filing.', durationMs: 6000 });
      }
    },
    onError: (e: any) => show({ kind: 'error', message: e?.response?.data?.message || 'Failed to load portal info', durationMs: 4000 }),
  });

  // Fetch pay group settings to get configured state for LWF/PT defaults
  const { data: payGroupSettingsData } = useQuery({
    queryKey: ['pay-group-settings'],
    queryFn: () => payrollApi.getPayGroupSettings().then((r) => r.data),
    enabled: !!selectedRun,
  });

  // Auto-select state from pay group filing details when run changes
  const runsList = Array.isArray(runs) ? runs : (runs as any)?.runs ?? [];
  const filingsList = filingsData?.data ?? filingsData ?? [];
  const employeesList = Array.isArray(employees) ? employees : (employees as any)?.data ?? [];

  const payGroups = (payGroupSettingsData as any)?.pay_groups ?? [];

  const filingStats = {
    generated: filingsList.length,
    filed: filingsList.filter((f: any) => f.status === 'filed' || f.status === 'acknowledged').length,
    pending: filingsList.filter((f: any) => f.status === 'generated' || f.status === 'pending').length,
    failed: filingsList.filter((f: any) => f.status === 'failed').length,
  };

  // When a run is selected, find its pay group and populate state defaults from filing_details
  const selectedRunData = runsList.find((r: any) => r.id === selectedRun);
  const runPayGroupId = selectedRunData?.pay_group_id as number | undefined;
  const payGroup = runPayGroupId
    ? payGroups.find((pg: { id: number; filing_details: PayGroupFilingDetail[] }) => pg.id === runPayGroupId)
    : undefined;

  useEffect(() => {
    if (payGroup?.filing_details && ptState === '' && lwfState === '') {
      const firstPtEnabled = payGroup.filing_details.find((d: PayGroupFilingDetail) => d.pt_enabled);
      const firstLwfEnabled = payGroup.filing_details.find((d: PayGroupFilingDetail) => d.lwf_enabled);
      if (firstPtEnabled && !ptState) setPtState(firstPtEnabled.state_code);
      if (firstLwfEnabled && !lwfState) setLwfState(firstLwfEnabled.state_code);
    }
  }, [payGroup, ptState, lwfState, setPtState, setLwfState]);

  const dueDates = (settings as any)?.compliance_due_dates ?? (settings as any)?.settings?.compliance_due_dates ?? {};

  /*
   * The server is the authority on which filings exist. Ten of the returns
   * below reference statutory templates that have never been written; without
   * this the screen advertises them as filing-ready and the generator throws
   * after the user commits to a run.
   */
  const { data: filingCatalogue } = useQuery({
    queryKey: ['filing-catalogue'],
    queryFn: () => payrollApi.getFilingCatalogue(),
    staleTime: 10 * 60 * 1000,
  });

  const filingCards = mergeCatalogueAvailability(FILING_CARDS, filingCatalogue ?? {});

  const calendarItems = FILING_CARDS
    .map((ft) => {
      const key = DUE_DATE_KEYS[ft.key];
      const due = key ? dueDates[key] : null;
      return due ? { label: ft.label, due } : null;
    })
    .filter(Boolean) as Array<{ label: string; due: string }>;

  const today = new Date();
  const isOverdue = (due: string) => {
    const d = new Date(due);
    return !isNaN(d.getTime()) && d < today;
  };

  const getDeadlineColor = (periodInfo: string): string => {
    const match = periodInfo.match(/Due:\s*(.+)/);
    if (!match) return 'text-slate-400';
    const dateStr = match[1].trim();
    const currentYear = new Date().getFullYear();
    let deadline = new Date(dateStr + ' ' + currentYear);
    if (isNaN(deadline.getTime())) return 'text-slate-400';
    if (deadline < today) {
      deadline = new Date(dateStr + ' ' + (currentYear + 1));
      if (isNaN(deadline.getTime())) return 'text-slate-400';
    }
    const diffDays = Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return 'text-rose-600';
    if (diffDays <= 7) return 'text-amber-600';
    return 'text-emerald-600';
  };

  const getPrerequisites = (card: typeof FILING_CARDS[number]): Array<{ label: string; met: boolean }> => {
    const prereqs: Array<{ label: string; met: boolean }> = [];
    const runReady = runValidation?.ready === true || (selectedRunData?.status && ['locked', 'approved', 'processed'].includes(selectedRunData.status));
    prereqs.push({ label: 'Payroll run locked/approved', met: !!runReady });

    if (card.key === 'pf_ecr' || card.key === 'full_ecr') {
      const total = employeesList.length;
      const withUan = employeesList.filter((e: any) => e.uan_number || e.uan).length;
      prereqs.push({ label: 'Employees have UAN numbers', met: total > 0 && withUan === total });
    }

    if (card.key === 'esi_challan') {
      const total = employeesList.length;
      const withEsi = employeesList.filter((e: any) => e.esi_ip_number).length;
      prereqs.push({ label: 'Employees have ESI IP numbers', met: total > 0 && withEsi === total });
      const esiCode = payGroup?.filing_details?.some((d: PayGroupFilingDetail) => d.esi_registration_number);
      prereqs.push({ label: 'ESIC code configured', met: !!esiCode });
    }

    if (card.key === 'form_24q') {
      const tanConfigured = (settings as any)?.tan_number || (settings as any)?.tan || payGroup?.filing_details?.some((d: PayGroupFilingDetail) => d.esi_registration_number);
      prereqs.push({ label: 'TAN configured', met: !!tanConfigured });
    }

    if (card.key === 'pt_return') {
      prereqs.push({ label: 'State selected', met: !!ptState });
    }

    if (card.key === 'lwf_return') {
      prereqs.push({ label: 'State selected', met: !!lwfState });
    }

    if (card.key === 'bonus_form_c' || card.key === 'bonus_form_d') {
      prereqs.push({ label: 'Bonus percentage configured', met: !!bonusPercent });
    }

    return prereqs;
  };

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Statutory Filings"
        description="Generate PF, ESI, PT, TDS and Form 16 returns from an approved payroll run — then file them on the relevant portal yourself."
      />
      <HowItWorksCard
        intro="Generate statutory returns locally, then you (the human) file them on the relevant portal. Different filing types have very different real workflows — the badge on each card tells you which."
        whatIsThis={
          'Statutory returns required by Indian law — PF, ESI, PT, TDS, LWF, Form 16. But they are NOT all filed the same way:' +
          '\n\n• PF ECR is generated in EPFO\'s exact ECR text format and is ready to upload.' +
          '\n• ESI & PT here are reference summaries / portal-aligned CSVs for manual portal entry — the real challan/return is generated on the ESIC / state tax portal.' +
          '\n• Form 24Q is source data; the actual e-TDS return must be built in NSDL-approved RPU software (FVU format) before filing with TDS-CPC.' +
          '\n• Form 16 Part B and Form 12BA are employer-computable PDFs; Form 16 Part A requires a TRACES step this system cannot replace.' +
          '\n• LWF is state-specific and must be configured for your state first.'
        }
        whenToUse={[
          'Monthly: PF ECR (upload-ready, due 15th of next month)',
          'Monthly: ESI & PT — use these summaries to key into the ESIC / state portals',
          'Quarterly: Form 24Q source data → build the real return in NSDL RPU → file with TDS-CPC',
          'Annually: Form 16 Part B + Form 12BA (PDFs) + attach TRACES Part A',
          'Annually: Bonus Form C (Payment of Bonus Act)',
          'LWF: when due for your configured state(s)',
        ]}
        howItFlows={[
          { step: 1, label: 'Pick a run', desc: 'Select the approved/locked payroll run you want to file' },
          { step: 2, label: 'Pick filing type', desc: 'Each card shows its real compliance status — filing-ready, reference-only, or not configured' },
          { step: 3, label: 'Generate', desc: 'System pulls data and formats it per what that return actually is' },
          { step: 4, label: 'File it yourself', desc: 'Use "Upload to portal" to open the right portal + exact file; then "Mark Filed" with the challan/ack number' },
        ]}
        commonMistakes={[
          'Treating the ESI/PT summary or Form 24Q export as a ready-to-upload file (they are not)',
          'Believing a self-assigned Form 16 certificate number is valid (only TRACES issues it)',
          'Generating filings from a draft run — always lock + approve before filing',
          'Missing statutory deadlines (penalties apply)',
        ]}
      />

      {calendarItems.length > 0 && (
        <SurfaceCard className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <CalendarClock className="h-4 w-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-700">Compliance calendar</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {calendarItems.map((c) => {
              const overdue = isOverdue(c.due);
              return (
                <span
                  key={c.label}
                  className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${
                    overdue ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-slate-50 text-slate-600 border-slate-200'
                  }`}
                >
                  {c.label} — due {new Date(c.due).toLocaleDateString()}
                  {overdue && <AlertCircle className="h-3 w-3" />}
                </span>
              );
            })}
          </div>
        </SurfaceCard>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant={activeTab === 'generate' ? 'primary' : 'secondary'}
          size="sm"
          iconLeft={<Plus className="h-4 w-4" />}
          onClick={() => setActiveTab('generate')}
        >
          Generate
        </Button>
        <Button
          variant={activeTab === 'form16' ? 'primary' : 'secondary'}
          size="sm"
          iconLeft={<FileText className="h-4 w-4" />}
          onClick={() => setActiveTab('form16')}
        >
          Form 16
        </Button>
        <Button
          variant={activeTab === 'upload-form16' ? 'primary' : 'secondary'}
          size="sm"
          iconLeft={<Upload className="h-4 w-4" />}
          onClick={() => setActiveTab('upload-form16')}
        >
          Upload Form 16
        </Button>
        <Button
          variant={activeTab === 'history' ? 'primary' : 'secondary'}
          size="sm"
          iconLeft={<History className="h-4 w-4" />}
          onClick={() => setActiveTab('history')}
        >
          Filing History
        </Button>
      </div>

      {activeTab === 'generate' ? (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-semibold text-slate-900">Generate Filings</h3>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<History className="h-4 w-4" />}
                onClick={() => setActiveTab('history')}
              >
                Filing History
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => selectedRun && generateAllMutation.mutate(selectedRun)}
                disabled={!selectedRun || generateAllMutation.isPending || (runValidation && !runValidation.ready)}
                iconLeft={generateAllMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
              >
                {generateAllMutation.isPending ? 'Generating...' : 'Generate All'}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <MetricCard label="Generated" value={filingStats.generated} accent="sky" icon={FileText} />
            <MetricCard label="Awaiting Filing" value={filingStats.pending} accent="amber" />
            <MetricCard label="Filed" value={filingStats.filed} accent="emerald" />
            <MetricCard label="Failed" value={filingStats.failed} accent="rose" />
          </div>

          <SurfaceCard className="p-5">
            <FieldLabel>Select Payroll Run</FieldLabel>
            {runsLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading runs...
              </div>
            ) : (
              <div className="max-w-md">
                <SelectInput
                  value={selectedRun ?? ''}
                  onChange={(e) => setSelectedRun(Number(e.target.value) || null)}
                >
                  <option value="">Choose a payroll run...</option>
                  {runsList.map((run: any) => (
                    <option key={run.id} value={run.id}>
                      {run.month_year} — {run.status} ({run.total_employees || run.employee_count || 0} employees)
                    </option>
                  ))}
                </SelectInput>
              </div>
            )}
            {runsList.length === 0 && !runsLoading && (
              <p className="mt-2 text-xs text-amber-600 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> No processed payroll runs found. Process and lock a run first.
              </p>
            )}
            {selectedRun && runValidation && !runValidation.ready && (
              <p className="mt-2 text-xs text-rose-600 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                Run is not approved/locked ({runValidation.run_status}). {runValidation.errors?.[0]?.message}
              </p>
            )}
            {selectedRun && runValidation?.ready && (
              <p className="mt-2 text-xs text-emerald-600 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Run {runValidation.run_status} — ready to generate from.
              </p>
            )}
          </SurfaceCard>

          {selectedRun && (
            <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filingCards.map((card) => {
                // "Not Due" is the wrong word for a form whose template was
                // never written — it implies it will become due. Say what is
                // actually true instead.
                const badge = card.available
                  ? FILING_DISPLAY[card.displayStatus]
                  : COMPLIANCE_BADGE.unavailable;
                const patternBadge = PATTERN_BADGE[card.pattern];
                const runReady = runValidation?.ready === true || (selectedRunData?.status && ['locked', 'approved', 'processed'].includes(selectedRunData.status));
                const runBlocked = !!selectedRun && !runReady;
                const disabled = generateSingleMutation.isPending || !!runBlocked || card.displayStatus === 'not_due';
                const canDownload = card.displayStatus === 'generated' || card.displayStatus === 'filed';
                const existingFiling = filingsList.find((f: any) => f.type === card.key && (f.status === 'generated' || f.status === 'filed' || f.status === 'approved'));
                const prereqs = getPrerequisites(card);
                const allPrereqsMet = prereqs.every(p => p.met);
                // An unavailable filing can never be generated, whatever the
                // run's state — there is no template to render.
                const generateDisabled = disabled || !card.available || (card.needsRun && !allPrereqsMet);

                return (
                  <SurfaceCard key={card.key} className={`p-4 border-l-4 ${patternBadge.borderColor}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-semibold text-slate-900 text-sm">{card.label}</h3>
                        <InfoTooltip content={card.tooltip} title={card.label} size="sm" />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${patternBadge.className}`}>
                          {patternBadge.label}
                        </span>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.className}`}>
                          {badge.label}
                        </span>
                      </div>
                    </div>
                    <p className={`text-xs mb-1 flex items-center gap-1 ${getDeadlineColor(card.periodInfo)}`}>
                      <CalendarClock className="h-3 w-3" />
                      {card.periodInfo}
                    </p>
                    {card.available ? (
                      <p className="text-xs text-slate-500 mb-2 flex items-center gap-1">
                        <HelpCircle className="h-3 w-3" />
                        {card.nextAction}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-600 mb-2 flex items-start gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
                        <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                        <span>{card.unavailableReason}</span>
                      </p>
                    )}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {canDownload && existingFiling && (
                        <Button
                          variant="secondary"
                          size="sm"
                          iconLeft={<Download className="h-3.5 w-3.5" />}
                          onClick={() => downloadMutation.mutate(existingFiling)}
                          disabled={downloadMutation.isPending}
                        >
                          {card.displayStatus === 'filed' ? 'Challan' : 'Download'}
                        </Button>
                      )}
                      {card.displayStatus === 'pending' && (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => generateSingleMutation.mutate({ type: card.key, runId: selectedRun })}
                          disabled={generateDisabled}
                          iconLeft={generateSingleMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : undefined}
                        >
                          Generate →
                        </Button>
                      )}
                      {card.displayStatus === 'not_due' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled
                        >
                          Generate
                        </Button>
                      )}
                      {canDownload && existingFiling && existingFiling.status !== 'filed' && existingFiling.status !== 'acknowledged' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-blue-600"
                          iconLeft={<Upload className="h-3.5 w-3.5" />}
                          onClick={() => portalInfoMutation.mutate(existingFiling.id)}
                          disabled={portalInfoMutation.isPending}
                          title="Open the government portal to upload/pre-fill"
                        >
                          Upload to portal
                        </Button>
                      )}
                      {canDownload && existingFiling && existingFiling.status === 'generated' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-emerald-600"
                          iconLeft={<Send className="h-3.5 w-3.5" />}
                          onClick={() => setMarkFiledFor(existingFiling.id)}
                        >
                          Mark Filed
                        </Button>
                      )}
                      {canDownload && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setActiveTab('history')}
                        >
                          History
                        </Button>
                      )}
                    </div>
                    {card.needsRun && (
                      <div className="mt-3 space-y-1">
                        {prereqs.map((p, i) => (
                          <div key={i} className="flex items-center gap-1.5 text-xs">
                            {p.met ? (
                              <Check className="h-3 w-3 text-emerald-600" />
                            ) : (
                              <span className="h-3 w-3 rounded-full bg-rose-200 flex-shrink-0" />
                            )}
                            <span className={p.met ? 'text-emerald-700' : 'text-rose-600'}>
                              {p.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {card.needsState && card.key === 'lwf_return' && !lwfState && (
                      <p className="text-[10px] text-rose-600 mt-2">Select your state to enable (some states unsupported).</p>
                    )}
                    {card.needsState && (
                      <div className="mt-2">
                        <select
                          value={card.key === 'lwf_return' ? lwfState : ptState}
                          onChange={(e) => card.key === 'lwf_return' ? setLwfState(e.target.value) : setPtState(e.target.value)}
                          disabled={disabled}
                          className="text-xs border border-slate-200 rounded px-2 py-1 bg-white w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Select state...</option>
                          {STATES.map((s) => (
                            <option key={s} value={s}>{fmtState(s)}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2 w-full text-xs"
                      onClick={() => setSelectedCard(selectedCard === card.key ? null : card.key)}
                    >
                      {selectedCard === card.key ? 'Hide details' : 'Details'}
                    </Button>
                  </SurfaceCard>
                );
              })}
            </div>
            {selectedCard && FILING_GUIDANCE[selectedCard] && (
              <HowItWorksCard
                title={`How ${FILING_CARDS.find(c => c.key === selectedCard)?.label} works`}
                whatIsThis={FILING_GUIDANCE[selectedCard].whatIsThis}
                whenToUse={FILING_GUIDANCE[selectedCard].whenToUse}
                howItFlows={FILING_GUIDANCE[selectedCard].howItFlows}
                commonMistakes={FILING_GUIDANCE[selectedCard].commonMistakes}
                defaultOpen={true}
              />
            )}
            </>
          )}

          {/*
            * Without this the area below the run picker was simply blank, which
            * reads as a broken page rather than a step you have not taken yet.
            */}
          {!selectedRun && !runsLoading && runsList.length > 0 && (
            <PageEmptyState
              title="Select a payroll run"
              description="Filings are generated from a specific run. Choose one above to see the returns available for it."
            />
          )}
        </>
      ) : activeTab === 'form16' ? (
        <SurfaceCard className="p-5">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Generate Form 16 Part B (Salary Statement)</h3>
          <p className="text-sm text-slate-500 mb-4">
            Form 16 Part B is generated per employee per financial year as a PDF. Select an employee and financial year to generate.
            It aggregates all monthly payroll data for the selected FY (Apr–Mar). Note: Part A — the TDS certificate bearing the
            number issued by TRACES — must be downloaded from TRACES after quarterly TDS filing and attached separately; this
            system cannot mint that certificate number.
          </p>
          {employeesLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading employees...
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <FieldLabel>Employee</FieldLabel>
                <SelectInput
                  value={form16EmployeeId ?? ''}
                  onChange={(e) => setForm16EmployeeId(Number(e.target.value) || null)}
                >
                  <option value="">Select employee...</option>
                  {employeesList.map((emp: any) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({emp.email})
                    </option>
                  ))}
                </SelectInput>
                {employeesList.length === 0 && (
                  <p className="mt-1 text-xs text-amber-600">No employees found in your organization.</p>
                )}
              </div>
              <div>
                <FieldLabel>Financial Year</FieldLabel>
                <SelectInput
                  value={form16FinancialYear}
                  onChange={(e) => setForm16FinancialYear(e.target.value)}
                >
                  <option value="">Select financial year...</option>
                  {financialYears.map(fy => (
                    <option key={fy} value={fy}>{fy}</option>
                  ))}
                </SelectInput>
              </div>
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              onClick={() => {
                if (form16EmployeeId && form16FinancialYear) {
                  generateForm16Mutation.mutate({ userId: form16EmployeeId, financialYear: form16FinancialYear });
                }
              }}
              disabled={generateForm16Mutation.isPending || !form16EmployeeId || !form16FinancialYear}
              iconLeft={generateForm16Mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
            >
              {generateForm16Mutation.isPending ? 'Generating...' : 'Generate Form 16'}
            </Button>
          </div>
{generateForm16Mutation.isError && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                <strong>Error:</strong>{' '}
                {(generateForm16Mutation.error as any)?.response?.data?.errors
                  ? Object.entries((generateForm16Mutation.error as any)?.response?.data?.errors).map(([_field, msgs]: [string, any]) =>
                      Array.isArray(msgs) ? msgs.join(', ') : msgs).join(' | ')
                  : (generateForm16Mutation.error as any)?.response?.data?.message || generateForm16Mutation.error?.message || 'Something went wrong'}
              </div>
            )}
        </SurfaceCard>
      ) : activeTab === 'upload-form16' ? (
        <div className="flex items-center justify-center py-12">
          <Button
            variant="primary"
            size="lg"
            iconLeft={<Upload className="h-5 w-5" />}
            onClick={() => setShowUploadModal(true)}
          >
            Upload Form 16 Files
          </Button>
        </div>
      ) : (
        <SurfaceCard className="overflow-hidden">
          {filingsLoading ? (
            <PageLoadingState label="Loading filing history…" />
          ) : !Array.isArray(filingsList) || filingsList.length === 0 ? (
            <PageEmptyState
              title="No filings generated yet"
              description="Use the Generate tab to create PF, ESI, TDS, PT or LWF returns."
            />
          ) : (
            <>
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
                <span className="text-sm font-medium text-slate-700">{filingsList.length} filing(s)</span>
                <Button
                  variant="secondary"
                  size="sm"
                  iconLeft={<Download className="h-4 w-4" />}
                  onClick={() => {
                    const headers = ['Type', 'Period', 'Status', 'Generated At'];
                    const rows = filingsList.map((f: any) => [
                      f.type?.replace(/_/g, ' ')?.toUpperCase() ?? f.type,
                      f.period_type === 'annual'
                        ? `FY ${f.period_year}-${(f.period_year || 0) + 1}`
                        : f.period_month
                          ? `${f.period_month}/${f.period_year}`
                          : `Q${f.period_quarter}/${f.period_year}`,
                      f.status,
                      f.generated_at ? new Date(f.generated_at).toLocaleDateString() : '',
                    ]);
                    const escapeCsv = (val: any) => {
                      const str = String(val ?? '');
                      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                        return '"' + str.replace(/"/g, '""') + '"';
                      }
                      return str;
                    };
                    const bom = '\uFEFF';
                    const csv = bom + [headers.join(','), ...rows.map(r => r.map(escapeCsv).join(','))].join('\n');
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `filings-history.csv`;
                    a.click();
                  }}
                >
                  Export CSV
                </Button>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Period</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Ack</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filingsList.map((filing: any) => (
                    <tr key={filing.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-900">{filing.type?.replace(/_/g, ' ')?.toUpperCase() ?? filing.type}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {filing.period_type === 'annual'
                          ? `FY ${filing.period_year}-${(filing.period_year || 0) + 1}`
                          : filing.period_month
                            ? `${filing.period_month}/${filing.period_year}`
                            : `Q${filing.period_quarter}/${filing.period_year}`
                        }
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[filing.status as FilingStatus] ?? 'bg-slate-100 text-slate-700'}`}>
                          {filing.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 max-w-[160px] truncate" title={filing.acknowledgment_number}>
                        {filing.acknowledgment_number || (filing.status === 'filed' || filing.status === 'acknowledged' ? '—' : '')}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {filing.file_path && (
                          <Button
                            variant="ghost"
                            size="sm"
                            iconLeft={<Download className="h-4 w-4" />}
                            onClick={() => downloadMutation.mutate(filing)}
                            disabled={downloadMutation.isPending}
                          >
                            Download
                          </Button>
                        )}
                        {filing.status !== 'filed' && filing.status !== 'acknowledged' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-blue-600"
                            iconLeft={<Upload className="h-4 w-4" />}
                            onClick={() => portalInfoMutation.mutate(filing.id)}
                            disabled={portalInfoMutation.isPending}
                            title="Open the government portal to upload/pre-fill"
                          >
                            Upload to portal
                          </Button>
                        )}
{filing.status === 'generated' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-emerald-600"
                            iconLeft={<Send className="h-4 w-4" />}
                            onClick={() => setMarkFiledFor(filing.id)}
                          >
                            Mark Filed
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </SurfaceCard>
      )}

      {markFiledFor !== null && (
        <Modal
          open
          onClose={() => setMarkFiledFor(null)}
          titleId="record-as-filed-title"
          size="md"
          panelClassName="p-6"
          busy={markFiledMutation.isPending}
          // The challan input carried autoFocus. The dialog focuses its panel
          // by default, which would silently win and leave the field unfocused.
          initialFocusRef={markFiledInputRef}
        >
            <h3 id="record-as-filed-title" className="text-lg font-semibold text-slate-900 mb-2">Record as Filed</h3>
            <p className="text-sm text-slate-500 mb-4">
              After you (the human) log in and pay on the government portal, paste the acknowledgement / challan number below. It is recorded in the filing history.
            </p>
            <label className="block text-sm font-medium text-slate-700 mb-1">Acknowledgement / Challan Number</label>
            <input
              ref={markFiledInputRef}
              value={ackInput}
              onChange={(e) => setAckInput(e.target.value)}
              placeholder="e.g. ACK1234567890"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex justify-end gap-2 mt-5">
              <Button variant="secondary" size="sm" onClick={() => setMarkFiledFor(null)}>Cancel</Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!ackInput.trim() || markFiledMutation.isPending}
                onClick={() => markFiledMutation.mutate({ id: markFiledFor, ack: ackInput.trim() })}
              >
                {markFiledMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            </div>
        </Modal>
      )}

      {/* Upload Form 16 Modal */}
      <UploadForm16Modal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        financialYear={form16FinancialYear}
        organizationName={organizationName}
      />
    </div>
  );
}
