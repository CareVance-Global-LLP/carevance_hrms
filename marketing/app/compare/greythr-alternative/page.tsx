import type { Metadata } from 'next';
import { ProductHero, PlaceholderNote } from '@/components/product/PageParts';

export const metadata: Metadata = {
  title: "CareVance as a greytHR alternative",
  description: "An honest comparison, including the areas where CareVance is the weaker choice.",
  alternates: { canonical: "/compare/greythr-alternative" },
};

export default function Page() {
  return (
    <>
      <ProductHero
        eyebrow={"Comparison"}
        title={"Where we fit, and where we do not."}
        lede={"This page will compare on capability that can be verified on both sides, with dates on anything quoted. Until it is written and checked, the “why CareVance” page carries the same argument — including the gaps."}
      />
      <PlaceholderNote topic={"comparison"} related={"the “why CareVance” page, which already covers where the argument stops"} />
    </>
  );
}
