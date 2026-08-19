/**
 * Folds server-reported filing availability into the dashboard's catalogue.
 *
 * The dashboard used to carry a hardcoded array of nineteen returns with every
 * one marked `complianceStatus: 'ready'` — including the ten whose blade
 * templates do not exist. The user clicked, and the generator threw. The
 * backend now serves the truth from `GET /payroll/filings/catalogue`; this
 * merges it in.
 */

export type CatalogueEntry = {
  label: string;
  available: boolean;
  unavailable_reason: string | null;
};

export type FilingLike = {
  key: string;
  label: string;
  complianceStatus: string;
  [k: string]: unknown;
};

export type MergedFiling = FilingLike & {
  available: boolean;
  unavailableReason: string | null;
};

export function mergeCatalogueAvailability<T extends FilingLike>(
  filings: T[],
  catalogue: Record<string, CatalogueEntry>,
): Array<T & { available: boolean; unavailableReason: string | null }> {
  return filings.map((filing) => {
    const entry = catalogue[filing.key];

    /*
     * A filing the server does not mention is treated as available.
     *
     * This default matters during a deploy skew: a client newer than its
     * backend would otherwise hide filings that work perfectly well, turning
     * a routine rollout into ten returns vanishing from the screen. Claiming
     * too much is the bug we are fixing, but silently hiding working
     * functionality is not the correction — the server is the authority, and
     * silence from it is not a denial.
     */
    if (!entry || entry.available) {
      return { ...filing, available: true, unavailableReason: null };
    }

    return {
      ...filing,
      available: false,
      unavailableReason: entry.unavailable_reason,
      /*
       * Deliberately NOT 'not_configured'. That badge reads "Not configured
       * for your state", which is a different claim and an untrue one — the
       * template is missing for everybody, in every state.
       */
      complianceStatus: 'unavailable',
    };
  });
}
