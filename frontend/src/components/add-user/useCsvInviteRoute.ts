import { useCallback, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  addUserService,
  type AdditionalInviteSettings,
  type CsvParseResult,
  type InviteOption,
} from '@/services/addUser';

export interface CsvImportSummary {
  parsedCount: number;
  successCount: number;
  errorCount: number;
}

interface UseCsvInviteRouteOptions {
  organizationId?: number;
  /** Groups and projects the parser resolves names against. */
  groups: InviteOption[];
  projects: InviteOption[];
  defaultProjectIds: number[];
  settings: AdditionalInviteSettings;
  joiningDate?: string;
  /** Turns an unknown error into the message shown to the admin. */
  toErrorMessage: (error: unknown, fallback: string) => string;
  onImported: (summary: { invitedCount: number; failedMessages: string[]; deferred: string[] }) => void;
  onFailed: (message: string) => void;
}

/**
 * Everything the CSV route owns: the chosen file, its parsed preview, the
 * import result, and the two mutations that move between them.
 *
 * Extracted from AddUserDrawer, where this state sat alongside the email and
 * link routes' state in one 924-line component — all of it live regardless of
 * which route was open, so a half-finished CSV import stayed in memory while
 * the admin was typing email addresses.
 *
 * The hook deliberately does not own feedback banners or query invalidation.
 * Those are shell concerns shared by all four routes, so they stay in the
 * shell and arrive here as `onImported` / `onFailed`.
 */
export function useCsvInviteRoute({
  organizationId,
  groups,
  projects,
  defaultProjectIds,
  settings,
  joiningDate,
  toErrorMessage,
  onImported,
  onFailed,
}: UseCsvInviteRouteOptions) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CsvParseResult | null>(null);
  const [summary, setSummary] = useState<CsvImportSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const parseMutation = useMutation({
    mutationFn: async (candidate: File) => {
      if (!addUserService.isSupportedImportFile(candidate.name)) {
        throw new Error('Only CSV and XLSX files are supported.');
      }
      return addUserService.parseImportFile(candidate, groups, projects);
    },
    onSuccess: (parsed) => {
      setPreview(parsed);
      setSummary(null);
      setErrorMessage(
        parsed.rows.length === 0 ? parsed.errors[0] || 'No usable rows found in this file.' : null,
      );
    },
    onError: (error: unknown) => {
      setPreview(null);
      setErrorMessage(toErrorMessage(error, 'Could not read this file.'));
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error('Organization context is required to import users.');
      if (!preview) throw new Error('Select a file first.');

      return addUserService.sendParsedRows(preview, {
        organizationId,
        defaultGroupIds: [],
        defaultProjectIds,
        settings,
        joiningDate: joiningDate || undefined,
      });
    },
    onSuccess: ({ parsed, result }) => {
      setSummary({
        parsedCount: parsed.rows.length,
        successCount: result.invitedCount,
        errorCount: result.failed.length,
      });
      const failedMessages = result.failed.map((item) => item.message);
      setErrorMessage(failedMessages.length > 0 ? failedMessages.join(' ') : null);
      onImported({
        invitedCount: result.invitedCount,
        failedMessages,
        deferred: result.deferredAssignments,
      });
    },
    onError: (error: unknown) => {
      const message = toErrorMessage(error, 'Failed to process CSV import.');
      setErrorMessage(message);
      onFailed(message);
    },
  });

  /** Selecting a file discards whatever the previous one produced. */
  const selectFile = useCallback(
    (next: File | null) => {
      setFile(next);
      setPreview(null);
      setSummary(null);
      setErrorMessage(null);
      if (next) parseMutation.mutate(next);
    },
    [parseMutation],
  );

  /*
   * The rows the parser rejected, as a file.
   *
   * A hundred-row import that fails on four is unusable as a wall of text —
   * this gives back something that opens beside the original spreadsheet.
   */
  const downloadErrors = useCallback(() => {
    if (!preview?.errors.length) return;

    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const content = ['issue', ...preview.errors.map(escape)].join('\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'carevance-import-issues.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }, [preview]);

  /**
   * Clear the last import's outcome without discarding the chosen file.
   *
   * The shell calls this when the route changes, so a stale "imported 12 rows"
   * summary does not follow the admin to the email tab.
   */
  const clearResult = useCallback(() => {
    setSummary(null);
    setErrorMessage(null);
  }, []);

  return {
    file,
    preview,
    clearResult,
    summary,
    errorMessage,
    isParsing: parseMutation.isPending,
    isImporting: importMutation.isPending,
    /** Rows that would be invited — what the shell counts against seats. */
    pendingRecipientCount: preview?.rows.length ?? 0,
    selectFile,
    confirmImport: importMutation.mutate,
    downloadErrors,
  };
}
