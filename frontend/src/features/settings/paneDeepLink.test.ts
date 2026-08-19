import { describe, expect, it } from 'vitest';
import { SETTINGS_FALLBACK_PANE, requestedPaneFromLocation, resolveInitialPane } from './paneDeepLink';
import { SETTINGS_TABS } from './settingsTabs';
import type { SettingsTabId } from './types';

/*
 * The two sets useSettingsController actually builds (see visibleTabs): the
 * personal panes are everyone's, the workspace ones are a strict admin's. A
 * deep link is resolved against that set rather than against the URL, so these
 * stand in for "who is asking".
 */
const EMPLOYEE_PANES: ReadonlySet<SettingsTabId> = new Set<SettingsTabId>([
  'profile',
  'notifications',
  'appearance',
  'security',
  'help',
]);

const ADMIN_PANES: ReadonlySet<SettingsTabId> = new Set<SettingsTabId>([
  ...EMPLOYEE_PANES,
  'organization',
  'billing',
]);

/**
 * The whole journey a real deep link makes: read the URL, then judge the token
 * against the panes this person may open. The controller does exactly this, so
 * asserting on the pair is what actually says "this link opens that pane".
 */
const paneForUrl = (
  pathname: string,
  search: string,
  allowedPaneIds: ReadonlySet<SettingsTabId>
): SettingsTabId | 'unchanged' => {
  const requested = requestedPaneFromLocation(pathname, search);
  // null is "the URL asked for nothing", which leaves the screen alone rather
  // than moving anybody — a different outcome from falling back to Profile.
  return requested === null ? 'unchanged' : resolveInitialPane(requested, allowedPaneIds);
};

describe('requestedPaneFromLocation', () => {
  it('reads ?pane= — the parameter the payment page sends', () => {
    // The production failure this exists for: PaymentPage sends an admin to
    // /settings?pane=organization when the invoice has no billing address.
    // Settings read `tab` only, so `pane` fell on the floor and the person
    // landed on Profile, typed their *personal* address into employee_profiles,
    // and the payment page went on refusing.
    expect(requestedPaneFromLocation('/settings', '?pane=organization')).toBe('organization');
  });

  it('reads ?tab= — the parameter the command bar and the sidebar send', () => {
    expect(requestedPaneFromLocation('/settings', '?tab=billing')).toBe('billing');
  });

  it('prefers pane over tab when a URL carries both', () => {
    expect(requestedPaneFromLocation('/settings', '?tab=billing&pane=organization')).toBe('organization');
  });

  it('reads the two panes that have a path of their own', () => {
    expect(requestedPaneFromLocation('/settings/integrations', '')).toBe('integrations');
    expect(requestedPaneFromLocation('/settings/custom-fields', '')).toBe('custom-fields');
    // A path pane is the whole address, so it outranks a leftover query string.
    expect(requestedPaneFromLocation('/settings/integrations', '?pane=organization')).toBe('integrations');
  });

  it('returns null when the URL names no pane at all', () => {
    expect(requestedPaneFromLocation('/settings', '')).toBeNull();
    expect(requestedPaneFromLocation('/settings', '?from=payment')).toBeNull();
  });

  it('treats a blank value as naming nothing', () => {
    // `?pane=` is what a half-built link looks like. It must not be read as a
    // request to move, because the controller uses "nothing asked for" to mean
    // "leave the pane the person is already on".
    expect(requestedPaneFromLocation('/settings', '?pane=')).toBeNull();
    expect(requestedPaneFromLocation('/settings', '?pane=%20%20')).toBeNull();
    // ...but a blank `pane` still lets a real `tab` through.
    expect(requestedPaneFromLocation('/settings', '?pane=&tab=security')).toBe('security');
  });

  it('hands back an unknown token rather than judging it', () => {
    // Reading and deciding are separate jobs: whether "payroll" is a pane this
    // person may open is resolveInitialPane's call, not the URL reader's.
    expect(requestedPaneFromLocation('/settings', '?pane=payroll')).toBe('payroll');
  });

  it('tolerates the shapes a pasted URL arrives in', () => {
    expect(requestedPaneFromLocation('/settings', 'pane=organization')).toBe('organization');
    expect(requestedPaneFromLocation('/settings', '?pane=%20organization%20')).toBe('organization');
    expect(requestedPaneFromLocation('/settings/', '')).toBeNull();
  });
});

describe('resolveInitialPane', () => {
  it('opens the pane a deep link asks for', () => {
    expect(resolveInitialPane('organization', ADMIN_PANES)).toBe('organization');
  });

  it('falls back to profile for a pane that does not exist', () => {
    // Settings.tsx indexes PANE_TITLES by the active pane and renders nothing
    // for an id it does not know, so an unrecognised value has to resolve to a
    // real pane rather than be passed through.
    expect(resolveInitialPane('organisation', ADMIN_PANES)).toBe('profile');
    expect(resolveInitialPane('payroll', ADMIN_PANES)).toBe('profile');
  });

  it('refuses to open a pane the person is not allowed to see', () => {
    // The rail would not offer Organization to an employee, and a URL must not
    // be a way around that.
    expect(resolveInitialPane('organization', EMPLOYEE_PANES)).toBe('profile');
    expect(resolveInitialPane('billing', EMPLOYEE_PANES)).toBe('profile');
  });

  it('ignores case, because these URLs get typed and pasted', () => {
    expect(resolveInitialPane('Organization', ADMIN_PANES)).toBe('organization');
    expect(resolveInitialPane('CUSTOM-FIELDS', new Set<SettingsTabId>(['custom-fields']))).toBe('custom-fields');
  });
});

describe('settings deep links, end to end', () => {
  it('opens Organization for the payment page link', () => {
    expect(paneForUrl('/settings', '?pane=organization', ADMIN_PANES)).toBe('organization');
  });

  it('sends an employee following the same link to Profile, not to a blank pane', () => {
    expect(paneForUrl('/settings', '?pane=organization', EMPLOYEE_PANES)).toBe('profile');
  });

  it('opens the right pane whatever case the link was pasted in', () => {
    expect(paneForUrl('/settings', '?pane=Organization', ADMIN_PANES)).toBe('organization');
    expect(paneForUrl('/settings', '?tab=BILLING', ADMIN_PANES)).toBe('billing');
  });

  it('leaves the screen alone when the URL asks for nothing', () => {
    expect(paneForUrl('/settings', '', ADMIN_PANES)).toBe('unchanged');
    expect(paneForUrl('/settings', '?pane=', ADMIN_PANES)).toBe('unchanged');
  });

  it('sends an unknown pane to Profile', () => {
    expect(paneForUrl('/settings', '?pane=payroll', ADMIN_PANES)).toBe('profile');
  });
});

describe('the deep-link vocabulary and the rail agree', () => {
  const TAB_IDS = new Set<string>(SETTINGS_TABS.map((tab) => tab.id));

  it('routes its hard-coded paths at panes the rail actually has', () => {
    // requestedPaneFromLocation spells 'integrations' and 'custom-fields' out
    // as string literals. Rename either tab id and those literals become dead
    // tokens that resolve to Profile. This catches that, because it compares
    // the reader's output against SETTINGS_TABS rather than against itself.
    for (const [pathname, expected] of [
      ['/settings/integrations', 'integrations'],
      ['/settings/custom-fields', 'custom-fields'],
    ] as const) {
      const requested = requestedPaneFromLocation(pathname, '');
      expect(requested).toBe(expected);
      expect(TAB_IDS.has(String(requested))).toBe(true);
    }
  });

  it('falls back to a pane that exists', () => {
    // Settings.tsx renders nothing for an id it does not know, so a fallback
    // renamed out of SETTINGS_TABS would be a blank screen.
    expect(TAB_IDS.has(SETTINGS_FALLBACK_PANE)).toBe(true);
  });
});
