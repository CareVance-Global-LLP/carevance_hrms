const PRODUCTIVE_KEYWORDS = [
  'github', 'gitlab', 'bitbucket', 'jira', 'confluence', 'notion', 'slack', 'teams', 'zoom',
  'vscode', 'visual studio', 'intellij', 'pycharm', 'webstorm', 'phpstorm', 'terminal',
  'powershell', 'cmd', 'postman', 'figma', 'miro', 'docs.google', 'sheets.google', 'drive.google',
  'stackoverflow', 'learn.microsoft', 'developer.mozilla', 'trello', 'asana', 'linear', 'clickup',
  'outlook', 'gmail', 'calendar.google', 'word', 'excel', 'powerpoint', 'meet.google',
  'chat.openai', 'chatgpt', 'claude.ai', 'gemini.google', 'code', 'cursor', 'android studio',
  'datagrip', 'dbeaver', 'tableplus', 'mysql workbench', 'navicat', 'canva',
];

const UNPRODUCTIVE_KEYWORDS = [
  'youtube', 'netflix', 'primevideo', 'hotstar', 'spotify', 'instagram', 'facebook', 'twitter',
  'x.com', 'reddit', 'snapchat', 'tiktok', 'discord', 'twitch', 'pinterest', '9gag',
  'telegram', 'whatsapp', 'web.whatsapp', 'wa.me', 'fb.com', 'reels', 'shorts', 'cricbuzz', 'espncricinfo',
];

const BROWSER_TITLE_PATTERNS = [
  /^(google chrome|chrome|microsoft edge|edge|mozilla firefox|firefox|brave|opera|vivaldi)\s*-\s*/i,
  /\s*-\s*(google chrome|chrome|microsoft edge|edge|mozilla firefox|firefox|brave|opera|vivaldi)$/i,
];

const BROWSER_APP_KEYWORDS = ['chrome', 'edge', 'firefox', 'brave', 'opera', 'safari', 'vivaldi'];

const KNOWN_SITE_LABELS: Array<{ label: string; keywords: string[] }> = [
  { label: 'instagram.com', keywords: ['instagram'] },
  { label: 'youtube.com', keywords: ['youtube', 'youtu.be'] },
  { label: 'netflix.com', keywords: ['netflix'] },
  { label: 'spotify.com', keywords: ['spotify'] },
  { label: 'facebook.com', keywords: ['facebook', 'fb.com'] },
  { label: 'x.com', keywords: ['x.com', 'twitter'] },
  { label: 'reddit.com', keywords: ['reddit'] },
  { label: 'tiktok.com', keywords: ['tiktok'] },
  { label: 'discord.com', keywords: ['discord'] },
  { label: 'web.whatsapp.com', keywords: ['web.whatsapp', 'whatsapp', 'wa.me'] },
  { label: 'twitch.tv', keywords: ['twitch'] },
  { label: 'pinterest.com', keywords: ['pinterest'] },
  { label: 'telegram.org', keywords: ['telegram'] },
  { label: 'primevideo.com', keywords: ['primevideo'] },
  { label: 'hotstar.com', keywords: ['hotstar'] },
  { label: 'cricbuzz.com', keywords: ['cricbuzz'] },
  { label: 'espncricinfo.com', keywords: ['espncricinfo'] },
  { label: 'github.com', keywords: ['github'] },
  { label: 'gitlab.com', keywords: ['gitlab'] },
  { label: 'bitbucket.org', keywords: ['bitbucket'] },
  { label: 'stackoverflow.com', keywords: ['stackoverflow'] },
  { label: 'figma.com', keywords: ['figma'] },
  { label: 'miro.com', keywords: ['miro'] },
  { label: 'canva.com', keywords: ['canva'] },
  { label: 'trello.com', keywords: ['trello'] },
  { label: 'asana.com', keywords: ['asana'] },
  { label: 'linear.app', keywords: ['linear'] },
  { label: 'clickup.com', keywords: ['clickup'] },
  { label: 'developer.mozilla.org', keywords: ['developer.mozilla'] },
  { label: 'learn.microsoft.com', keywords: ['learn.microsoft'] },
  { label: 'chat.openai.com', keywords: ['chat.openai', 'chatgpt'] },
  { label: 'claude.ai', keywords: ['claude.ai'] },
  { label: 'gemini.google', keywords: ['gemini.google'] },
  { label: 'snapchat.com', keywords: ['snapchat'] },
  { label: '9gag.com', keywords: ['9gag'] },
];

export const guessToolType = (activityType: string) =>
  String(activityType || '').trim().toLowerCase() === 'url' ? 'website' : 'software';

export const cleanBrowserWindowTitle = (title: string) => {
  let value = String(title || '').trim().replace(/^\(\d+\)\s*/u, '');

  if (!value) {
    return value;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const previous = value;

    BROWSER_TITLE_PATTERNS.forEach((pattern) => {
      value = value.replace(pattern, '').trim();
    });

    if (value === previous) {
      break;
    }
  }

  return value.replace(/\s+/g, ' ').trim();
};

const resolveKnownSiteLabel = (value: string) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  const matchedSite = KNOWN_SITE_LABELS.find(({ keywords }) => keywords.some((keyword) => normalized.includes(keyword)));
  return matchedSite?.label || '';
};

const decodePercentEncodedText = (value: string) => {
  const source = String(value || '').trim();
  if (!source || !source.includes('%')) {
    return source;
  }

  try {
    return decodeURIComponent(source);
  } catch {
    return source;
  }
};

const looksLikeResolvableUrl = (value: string) => {
  const candidate = String(value || '').trim();
  if (!candidate) {
    return false;
  }

  return /^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)
    || /^www\./i.test(candidate)
    || /^localhost(?::\d+)?(?:\/|$)/i.test(candidate)
    || /^127\.0\.0\.1(?::\d+)?(?:\/|$)/i.test(candidate)
    || /([a-z0-9-]+\.)+[a-z]{2,}/i.test(candidate);
};

export const normalizeActivityToolLabel = (name: string, activityType: string) => {
  const trimmed = String(name || '').trim();
  const normalizedType = String(activityType || '').trim().toLowerCase();

  if (!trimmed) {
    return normalizedType === 'url' ? 'unknown-site' : 'unknown-app';
  }

  if (normalizedType === 'url') {
    const decodedValue = decodePercentEncodedText(trimmed);

    if (looksLikeResolvableUrl(decodedValue)) {
      try {
        const parsed = new URL(decodedValue.includes('://') ? decodedValue : `https://${decodedValue}`);
        return parsed.hostname.replace(/^www\./, '').toLowerCase();
      } catch {
        const match = decodedValue.match(/([a-z0-9-]+\.)+[a-z]{2,}/i);
        if (match?.[0]) {
          return match[0].replace(/^www\./, '').toLowerCase();
        }
      }
    } else {
      const match = decodedValue.match(/([a-z0-9-]+\.)+[a-z]{2,}/i);
      if (match?.[0]) {
        return match[0].replace(/^www\./, '').toLowerCase();
      }
    }

    const cleanedTitle = cleanBrowserWindowTitle(decodedValue);
    const knownSiteLabel = resolveKnownSiteLabel(cleanedTitle);
    if (knownSiteLabel) {
      return knownSiteLabel;
    }

    return cleanedTitle.slice(0, 120) || 'browser';
  }

  return trimmed.slice(0, 120);
};

export const classifyActivityProductivity = (toolLabel: string, activityType: string) => {
  const text = String(toolLabel || '').toLowerCase();
  const normalizedType = String(activityType || '').trim().toLowerCase();
  const isProductive = PRODUCTIVE_KEYWORDS.some((keyword) => text.includes(keyword));
  const isUnproductive = UNPRODUCTIVE_KEYWORDS.some((keyword) => text.includes(keyword));

  if (isUnproductive && !isProductive) return 'unproductive';
  if (isProductive && !isUnproductive) return 'productive';
  if (normalizedType === 'idle') return 'neutral';
  if (normalizedType === 'url' || normalizedType === 'app') return 'productive';
  return 'neutral';
};

export const buildTrackedContextName = (context: { app?: string | null; title?: string | null; url?: string | null }) => {
  const appName = String(context?.app || '').trim();
  const title = String(context?.title || '').trim();
  const url = String(context?.url || '').trim();
  const isBrowserApp = BROWSER_APP_KEYWORDS.some((keyword) => appName.toLowerCase().includes(keyword));

  if (url) {
    return url.slice(0, 255);
  }

  if (isBrowserApp && title) {
    const cleanedTitle = cleanBrowserWindowTitle(title);
    return (cleanedTitle || title).slice(0, 255);
  }

  return [appName, title].filter(Boolean).join(' - ').slice(0, 255);
};
