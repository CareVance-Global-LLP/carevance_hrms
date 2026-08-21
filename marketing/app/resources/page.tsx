import type { Metadata } from 'next';
import { ProductHero, PlaceholderNote } from '@/components/product/PageParts';

export const metadata: Metadata = {
  title: "Guides & resources",
  description: "Practical guides to Indian payroll and compliance.",
  alternates: { canonical: "/resources" },
};

export default function Page() {
  return (
    <>
      <ProductHero
        eyebrow={"Resources"}
        title={"Guides to the things Indian payroll gets wrong."}
        lede={"Written explanations of the rules the calculators implement — the ESI contribution period, the professional tax ceiling, the Section 87A marginal relief band, and what a residual salary component actually does."}
      />
      <PlaceholderNote topic={"guides section"} related={"the free calculators, which each carry a written explanation of their rule"} />
    </>
  );
}
