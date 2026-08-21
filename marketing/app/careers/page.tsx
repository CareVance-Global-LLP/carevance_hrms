import type { Metadata } from 'next';
import { ProductHero, PlaceholderNote } from '@/components/product/PageParts';

export const metadata: Metadata = {
  title: "Careers at CareVance",
  description: "Open roles at CareVance.",
  alternates: { canonical: "/careers" },
};

export default function Page() {
  return (
    <>
      <ProductHero
        eyebrow={"Careers"}
        title={"We are small, and we hire rarely."}
        lede={"There is no open-roles list here yet, and we would rather show an empty page than a permanent “we are always hiring” that goes nowhere. If you have read the security or methodology pages and recognised how we think, write to us anyway."}
      />
      <PlaceholderNote topic={"careers page"} related={"the contact page"} />
    </>
  );
}
