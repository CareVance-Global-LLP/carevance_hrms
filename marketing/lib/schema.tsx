/**
 * JSON-LD builders.
 *
 * Structured data is the machine-readable half of the argument (brief §10.3).
 * Two competitors researched return near-nothing to a text crawler because
 * their homepages render client-side; that is a real liability now that AI
 * answers are a discovery channel. Everything here is emitted server-side.
 *
 * Rule: schema may only assert what the visible page asserts. No aggregateRating
 * (there are no reviews), no award, no employee count we have not counted.
 */

import { SITE } from './site';
import { PLANS, GST_PERCENT, type Plan } from './pricing';

const abs = (path: string) => new URL(path, SITE.url).toString();

export function organizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': abs('/#organization'),
    name: SITE.name,
    legalName: SITE.legalName,
    url: SITE.url,
    description: SITE.description,
    email: SITE.salesEmail,
    areaServed: { '@type': 'Country', name: 'India' },
    contactPoint: [
      {
        '@type': 'ContactPoint',
        contactType: 'sales',
        email: SITE.salesEmail,
        availableLanguage: ['en'],
      },
      {
        '@type': 'ContactPoint',
        contactType: 'customer support',
        email: SITE.supportEmail,
        availableLanguage: ['en'],
      },
    ],
  };
}

export function softwareApplicationSchema() {
  const paid = PLANS.filter((p) => !p.contactOnly);

  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': abs('/#software'),
    name: SITE.name,
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'Human Resources & Payroll',
    operatingSystem: 'Web, Windows, macOS, Android, iOS',
    description: SITE.description,
    url: SITE.url,
    publisher: { '@id': abs('/#organization') },
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'INR',
      // The cheapest real entry point (per-seat Basic) and the highest listed
      // headline. Enterprise is excluded: it has no published price.
      lowPrice: Math.min(...paid.map(minMonthly)),
      highPrice: Math.max(...paid.map(minMonthly)),
      offerCount: paid.length,
    },
  };
}

/** The smallest amount a plan can cost in a month, used for offer ranges. */
function minMonthly(plan: Plan): number {
  if (plan.monthlyPerSeat !== null) return plan.monthlyPerSeat;
  return plan.basePrice ?? 0;
}

export function productOfferSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: `${SITE.name} HR & Payroll`,
    description: SITE.description,
    brand: { '@id': abs('/#organization') },
    offers: PLANS.filter((p) => !p.contactOnly).map((plan) => ({
      '@type': 'Offer',
      name: `${plan.label} — ${plan.tagline}`,
      sku: plan.code,
      priceCurrency: 'INR',
      price: minMonthly(plan),
      url: abs('/pricing'),
      availability: 'https://schema.org/InStock',
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: minMonthly(plan),
        priceCurrency: 'INR',
        valueAddedTaxIncluded: false,
        unitText:
          plan.monthlyPerSeat !== null ? 'per user per month' : 'per workspace per month',
        description:
          plan.monthlyPerSeat !== null
            ? `Per seat, minimum 10 seats. Excludes ${GST_PERCENT}% GST.`
            : `Includes ${plan.includedSeats} seats; ₹${plan.extraSeatPrice} per additional seat. Excludes ${GST_PERCENT}% GST.`,
      },
    })),
  };
}

export function faqSchema(items: ReadonlyArray<{ q: string; a: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  };
}

export function breadcrumbSchema(trail: ReadonlyArray<{ label: string; href: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.label,
      item: abs(crumb.href),
    })),
  };
}

/** Renders a schema object into the page. Server component, no client cost. */
export function JsonLd({ schema }: { schema: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
