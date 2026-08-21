import type { Metadata } from 'next';
import { ProductHero, PlaceholderNote } from '@/components/product/PageParts';

export const metadata: Metadata = {
  title: "Reports & controls",
  description: "Differences, negative-cost, duplicate and reconciliation reports, payroll and statutory registers, GL mapping and burn rate.",
  alternates: { canonical: "/product/reports" },
};

export default function Page() {
  return (
    <>
      <ProductHero
        eyebrow={"Reports & controls"}
        title={"Find the mistake before the money moves."}
        lede={"Four detective reports run against a payroll run rather than after it: what differs from last month and why, who carries a negative cost, what is duplicated, and whether the run reconciles. Then the payroll and statutory registers finance actually asks for, plus GL mapping, cost centres and burn rate."}
      />
      <PlaceholderNote topic={"reporting"} related={"the payroll page"} />
    </>
  );
}
