import type { Metadata } from 'next';
import { ProductHero, PlaceholderNote } from '@/components/product/PageParts';

export const metadata: Metadata = {
  title: "HR & payroll for staffing agencies",
  description: "Bill what was actually worked, with the evidence attached — the strongest fit for a platform where the tracker and the payroll engine are one system.",
  alternates: { canonical: "/solutions/staffing-agencies" },
};

export default function Page() {
  return (
    <>
      <ProductHero
        eyebrow={"Staffing & contract agencies"}
        title={"Bill what was worked, with the evidence attached to it."}
        lede={"This is the segment where owning the whole chain stops being an architectural nicety. When your margin is the gap between what a client is billed and what a contractor is paid, and both derive from the same hours, having the evidence and the payslip in one system is the difference between a clean month and an argument."}
      />
      <PlaceholderNote topic={"staffing agency"} related={"the time and attendance page"} />
    </>
  );
}
