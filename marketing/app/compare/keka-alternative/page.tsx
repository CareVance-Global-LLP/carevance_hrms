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
        lede={"A comparison page is only useful if it is willing to lose. When this one is written it will state plainly that CareVance has no recruitment module and no SSO, and that a buyer whose evaluation turns on either should not choose us — alongside where owning the tracker-to-payslip chain is a genuine advantage."}
      />
      <PlaceholderNote topic={"comparison"} related={"the “why CareVance” page, which already covers where the argument stops"} />
    </>
  );
}
