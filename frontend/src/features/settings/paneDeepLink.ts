/**
 * Which settings pane a URL is asking for.
 *
 * Other screens link straight at a pane — the payment page sends someone to
 * `/settings?pane=organization` when the invoice has no billing address, the
 * command bar uses `?tab=…` — so the address bar has to be able to decide what
 * opens. Until this existed the query string was read for `tab` only and
 * `pane` was dropped on the floor, which put people on Profile: they filled in
 * their *personal* address, that went to `employee_profiles`, the organization
 * address stayed empty and the payment page went on refusing.
 *
 * The work splits in two, because the two halves fail differently and so have
 * to be provable separately:
 *
 *   requestedPaneFromLocation — reads the raw URL. This is the half that was
 *     broken; it is where a parameter can be forgotten.
 *   resolveInitialPane — judges the token against the panes this person may
 *     open. This is where a URL could otherwise become a way round the rail.
 *
 * Both are pure and live outside the controller so they can be tested on their
 * own. Exercising them only through the Settings page would mean mocking every
 * endpoint that screen loads, and an unmocked one retries three times and
 * hangs the run.
 */
import type { SettingsTabId } from './types';

/**
 * Where an unusable deep link lands. Settings.tsx looks the heading up by pane
 * id and renders each pane on an exact match, so an id it does not know is a
 * blank screen — the fallback has to be a real pane, not '' or null.
 */
export const SETTINGS_FALLBACK_PANE: SettingsTabId = 'profile';

/**
 * Panes reached by their own path rather than by a query parameter, mapped
 * from the path suffix the router leaves on `location.pathname`.
 */
const PANE_PATH_SUFFIXES: ReadonlyArray<readonly [string, string]> = [
  ['/integrations', 'integrations'],
  ['/custom-fields', 'custom-fields'],
];

/**
 * Both parameter names are honoured because both are already in the wild:
 * `?pane=` from the payment page's billing-address prompt, `?tab=` from the
 * command bar and the sidebar. `pane` is read first only so that a URL
 * carrying both is not ambiguous.
 */
const PANE_QUERY_KEYS = ['pane', 'tab'] as const;

/**
 * Read the pane a location is asking for, without judging whether it exists or
 * whether the person may open it — that is resolveInitialPane's job.
 *
 * @param pathname `location.pathname`, e.g. '/settings' or '/settings/integrations'
 * @param search `location.search`, e.g. '?pane=organization' (a leading '?' is optional)
 * @returns the requested pane token, or null when the URL names none
 */
export const requestedPaneFromLocation = (pathname: string, search: string): string | null => {
  // A pane with its own path is the whole address, so it outranks whatever
  // query string happens to still be attached.
  const path = String(pathname ?? '').replace(/\/+$/, '');
  const pathPane = PANE_PATH_SUFFIXES.find(([suffix]) => path.endsWith(suffix));
  if (pathPane) {
    return pathPane[1];
  }

  const params = new URLSearchParams(String(search ?? ''));
  for (const key of PANE_QUERY_KEYS) {
    // Trimmed here rather than downstream: these URLs get typed, pasted and
    // forwarded, and `?pane=` on a half-built link has to read as "asked for
    // nothing" rather than as a request to move. The controller uses null to
    // mean "leave the person on the pane they are already looking at".
    const value = (params.get(key) ?? '').trim();
    if (value) {
      return value;
    }
  }

  return null;
};

/**
 * Resolve the pane a URL named against the panes this person may open.
 *
 * `allowedPaneIds` is the controller's visible-tab set, which is already
 * filtered by role — so membership answers "does this pane exist" and "may
 * they see it" at once, and a URL cannot become a way around the rail.
 *
 * Takes a plain string, not a nullable one: the only caller composes this with
 * requestedPaneFromLocation, which has already turned "no pane named" into
 * null and handled it separately.
 *
 * @param paneParam a pane token read off the URL
 * @param allowedPaneIds the panes the rail is currently offering
 */
export const resolveInitialPane = (
  paneParam: string,
  allowedPaneIds: ReadonlySet<SettingsTabId>
): SettingsTabId => {
  // Case is normalised here rather than in the reader because it is a fact
  // about the pane vocabulary, not about URLs: a capital should not cost
  // someone the pane they were sent to.
  const requested = paneParam.trim().toLowerCase() as SettingsTabId;

  return allowedPaneIds.has(requested) ? requested : SETTINGS_FALLBACK_PANE;
};
