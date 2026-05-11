import { apiBaseUrl } from '@/lib/runtimeConfig';

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const isLocalHost = (hostname: string) => hostname === 'localhost' || hostname === '127.0.0.1';

export const resolveMediaUrl = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }

  const candidate = value.trim();
  if (!candidate) {
    return '';
  }

  if (candidate.startsWith('blob:') || candidate.startsWith('data:')) {
    return candidate;
  }

  const base = trimTrailingSlash(apiBaseUrl);

  if (/^https?:\/\//i.test(candidate)) {
    try {
      const parsed = new URL(candidate);
      if (typeof window !== 'undefined') {
        const currentHost = window.location.hostname;
        if (isLocalHost(parsed.hostname) && !isLocalHost(currentHost)) {
          const apiOrigin = new URL(base).origin;
          return `${apiOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
        }
      }
      return candidate;
    } catch {
      return candidate;
    }
  }

  if (candidate.startsWith('//')) {
    if (typeof window === 'undefined') {
      return `https:${candidate}`;
    }
    return `${window.location.protocol}${candidate}`;
  }

  if (candidate.startsWith('/')) {
    return `${base}${candidate}`;
  }

  return `${base}/${candidate.replace(/^\/+/, '')}`;
};
