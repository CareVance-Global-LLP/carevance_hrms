import { isAuthenticatedAppPath } from '@/lib/publicRoutes';
import { webAppUrl } from '@/lib/runtimeConfig';
import { BRAND, brandLabel, productLabel } from '@/config/brand';

interface RouteMetadata {
  title: string;
  description: string;
  robots: string;
  canonicalPath: string | null;
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>;
}

const siteOrigin = webAppUrl.replace(/\/+$/, '');
const siteName = productLabel;
const defaultDescription =
  `${siteName} helps teams manage attendance, reports, onboarding, monitoring, payroll workflows, and day-to-day workforce operations from one connected workspace.`;
/*
 * Empty when un-branded: there is no vendor mark to advertise, and a link
 * preview pointing at a logo the deployment does not use is worse than one
 * with no image at all. Every consumer below omits the tag when this is ''.
 */
const defaultImage = BRAND.enabled ? `${siteOrigin}${BRAND.logoFull}?v=brand-1` : '';

function buildMarketingJsonLd(pathname: string) {
  const pageUrl = `${siteOrigin}${pathname}`;

  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: siteName,
      url: siteOrigin,
      ...(defaultImage ? { logo: defaultImage } : {}),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: siteName,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      url: pageUrl,
      description: defaultDescription,
    },
  ];
}

export function getRouteMetadata(pathname: string): RouteMetadata {
  if (isAuthenticatedAppPath(pathname)) {
    return {
      /*
       * Un-branded, `${siteName} Workspace` renders as "HR and payroll
       * Workspace" — the product-category stand-in reads as a name here and
       * the title turns to mush. The word alone is what this screen is.
       */
      title: BRAND.enabled ? `${siteName} Workspace` : 'Workspace',
      description: `Secure ${brandLabel} workspace area.`,
      robots: 'noindex,nofollow',
      canonicalPath: null,
    };
  }

  if (pathname === '/') {
    return {
      title: `${siteName} | Workforce Monitoring, Attendance, Reports, and Payroll`,
      description: defaultDescription,
      robots: 'index,follow',
      canonicalPath: '/',
      jsonLd: buildMarketingJsonLd(pathname),
    };
  }

  if (pathname === '/pricing') {
    return {
      title: `Pricing | ${siteName}`,
      description:
        `Compare ${siteName} plans for workforce monitoring, attendance, reporting, onboarding, and payroll-ready operations.`,
      robots: 'index,follow',
      canonicalPath: '/pricing',
      jsonLd: buildMarketingJsonLd(pathname),
    };
  }

  if (pathname === '/contact-sales' || pathname === '/book-demo') {
    return {
      title: `Contact Sales | ${siteName}`,
      description:
        `Talk with the ${brandLabel} team about rollout planning, onboarding workflows, pricing, and enterprise support.`,
      robots: 'index,follow',
      canonicalPath: '/contact-sales',
      jsonLd: buildMarketingJsonLd('/contact-sales'),
    };
  }

  if (pathname === '/support') {
    return {
      title: `Support | ${siteName}`,
      description:
        `Contact ${brandLabel} support, share product issues, and submit bug reports through the public help channel.`,
      robots: 'index,follow',
      canonicalPath: '/support',
      jsonLd: buildMarketingJsonLd(pathname),
    };
  }

  if (pathname === '/privacy') {
    return {
      title: `Privacy Policy | ${siteName}`,
      description: `Review the ${brandLabel} privacy policy placeholder prepared for pre-launch legal review.`,
      robots: 'index,follow',
      canonicalPath: '/privacy',
    };
  }

  if (pathname === '/terms') {
    return {
      title: `Terms & Conditions | ${siteName}`,
      description: `Review the ${brandLabel} terms placeholder prepared for pre-launch legal review.`,
      robots: 'index,follow',
      canonicalPath: '/terms',
    };
  }

  if (pathname === '/signup-owner' || pathname === '/register') {
    return {
      title: `Create Your Workspace | ${siteName}`,
      description:
        `Start a ${brandLabel} workspace for attendance, monitoring, reporting, onboarding, and payroll-ready operations.`,
      robots: 'index,follow',
      canonicalPath: '/signup-owner',
    };
  }

  if (pathname === '/start-trial') {
    return {
      title: `Start Free Trial | ${siteName}`,
      description:
        `Launch a ${brandLabel} free trial and create your owner workspace with plan and billing intent preselected.`,
      robots: 'index,follow',
      canonicalPath: '/start-trial',
    };
  }

  if (pathname === '/login') {
    return {
      title: `Sign In | ${siteName}`,
      description: `Access your ${brandLabel} workspace.`,
      robots: 'noindex,nofollow',
      canonicalPath: '/login',
    };
  }

  if (pathname === '/forgot-password') {
    return {
      title: `Forgot Password | ${siteName}`,
      description: `Request a password reset for your ${brandLabel} account.`,
      robots: 'noindex,nofollow',
      canonicalPath: null,
    };
  }

  if (pathname === '/reset-password') {
    return {
      title: `Reset Password | ${siteName}`,
      description: `Reset your ${brandLabel} account password.`,
      robots: 'noindex,nofollow',
      canonicalPath: null,
    };
  }

  if (pathname === '/verify-email') {
    return {
      title: `Verify Email | ${siteName}`,
      description: `Verify your ${brandLabel} account email address.`,
      robots: 'noindex,nofollow',
      canonicalPath: null,
    };
  }

  if (pathname.startsWith('/accept-invite/')) {
    return {
      title: `Accept Invitation | ${siteName}`,
      description: `Accept your ${brandLabel} invitation to join an existing workspace.`,
      robots: 'noindex,nofollow',
      canonicalPath: null,
    };
  }

  if (pathname === '/signup') {
    return {
      title: `Invitation Signup | ${siteName}`,
      description: `Continue your ${brandLabel} invite signup flow.`,
      robots: 'noindex,nofollow',
      canonicalPath: null,
    };
  }

  return {
    title: siteName,
    description: defaultDescription,
    robots: 'noindex,nofollow',
    canonicalPath: null,
  };
}

function ensureMetaTag(selector: string, create: () => HTMLMetaElement) {
  let element = document.head.querySelector<HTMLMetaElement>(selector);

  if (!element) {
    element = create();
    document.head.appendChild(element);
  }

  return element;
}

function ensureLinkTag(selector: string, create: () => HTMLLinkElement) {
  let element = document.head.querySelector<HTMLLinkElement>(selector);

  if (!element) {
    element = create();
    document.head.appendChild(element);
  }

  return element;
}

function setMetaByName(name: string, content: string) {
  const element = ensureMetaTag(`meta[name="${name}"]`, () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', name);
    return meta;
  });

  element.setAttribute('content', content);
}

function setMetaByProperty(property: string, content: string) {
  const element = ensureMetaTag(`meta[property="${property}"]`, () => {
    const meta = document.createElement('meta');
    meta.setAttribute('property', property);
    return meta;
  });

  element.setAttribute('content', content);
}

export function applyRouteMetadata(pathname: string) {
  if (typeof document === 'undefined') {
    return;
  }

  const metadata = getRouteMetadata(pathname);
  const canonicalUrl = metadata.canonicalPath ? `${siteOrigin}${metadata.canonicalPath}` : '';
  const currentUrl = `${siteOrigin}${pathname}`;

  document.title = metadata.title;
  setMetaByName('description', metadata.description);
  setMetaByName('robots', metadata.robots);
  setMetaByName('application-name', siteName);
  setMetaByProperty('og:site_name', siteName);
  setMetaByProperty('og:title', metadata.title);
  setMetaByProperty('og:description', metadata.description);
  setMetaByProperty('og:type', 'website');
  if (defaultImage) setMetaByProperty('og:image', defaultImage);
  setMetaByProperty('og:url', canonicalUrl || currentUrl);
  setMetaByName('twitter:card', 'summary_large_image');
  setMetaByName('twitter:title', metadata.title);
  setMetaByName('twitter:description', metadata.description);
  if (defaultImage) setMetaByName('twitter:image', defaultImage);

  const canonicalLink = ensureLinkTag('link[rel="canonical"]', () => {
    const link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    return link;
  });

  if (metadata.canonicalPath) {
    canonicalLink.setAttribute('href', canonicalUrl);
  } else {
    canonicalLink.removeAttribute('href');
  }

  const existingStructuredData = document.getElementById('carevance-structured-data');
  if (existingStructuredData) {
    existingStructuredData.remove();
  }

  if (metadata.jsonLd) {
    const script = document.createElement('script');
    script.id = 'carevance-structured-data';
    script.type = 'application/ld+json';
    script.text = JSON.stringify(metadata.jsonLd);
    document.head.appendChild(script);
  }
}
