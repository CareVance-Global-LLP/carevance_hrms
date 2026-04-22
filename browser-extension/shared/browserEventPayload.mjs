export const isTrackableBrowserUrl = (url) => {
  const value = String(url || '').trim().toLowerCase();
  if (!value) return false;

  return /^https?:\/\//.test(value);
};

export const buildBrowserTrackingEvent = ({
  kind,
  browserName,
  profileKey,
  recordedAt,
  tab,
}) => {
  const url = String(tab?.url || '').trim();
  const allowsMissingUrl = kind === 'tab-closed' || kind === 'window-blurred';
  if (!allowsMissingUrl && !isTrackableBrowserUrl(url)) {
    return null;
  }

  return {
    kind,
    browser_name: String(browserName || '').trim().toLowerCase(),
    profile_key: String(profileKey || '').trim(),
    tab_id: Number(tab?.id || 0) || null,
    window_id: Number(tab?.windowId || 0) || null,
    url: url || null,
    title: String(tab?.title || '').trim() || null,
    recorded_at: recordedAt,
  };
};

export const buildBrowserBridgeCredential = ({
  browserProfileId,
  pairingCode,
  pairedAt,
}) => ({
  browser_profile_id: String(browserProfileId || '').trim(),
  pairing_code: String(pairingCode || '').trim(),
  paired_at: pairedAt,
  bridge_status: 'paired',
});
