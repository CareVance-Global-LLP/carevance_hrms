import type { Metadata } from 'next';
import { ProductHero, PlaceholderNote } from '@/components/product/PageParts';

export const metadata: Metadata = {
  title: "CareVance as a Keka alternative",
  description: "An honest comparison, including the areas where CareVance is the weaker choice.",
  alternates: { canonical: "/compare/keka-alternative" },
};

export default function Page() {
  return (
    <>
      <ProductHero
        eyebrow={"Comparison"}
        title={"Where we fit, and where we do not."}
        lede={"A comparison page is only useful if it is willing to lose. When this one is written it will state plainly where we are the weaker choice — candidates cannot apply to us without a careers page, SCIM does not sync groups, and background verification has no vendor behind it — alongside where owning the tracker-to-payslip chain is a genuine advantage. Anything quoted about a competitor will carry the date it was verified."}
      />
      <PlaceholderNote topic={"comparison"} related={"the “why CareVance” page, which already covers where the argument stops"} />
    </>
  );
}
