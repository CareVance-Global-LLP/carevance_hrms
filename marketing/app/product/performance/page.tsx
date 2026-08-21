import type { Metadata } from 'next';
import { ProductHero, PlaceholderNote } from '@/components/product/PageParts';

export const metadata: Metadata = {
  title: "Performance",
  description: "Review cycles, goals, check-ins, competencies and 360 aggregation.",
  alternates: { canonical: "/product/performance" },
};

export default function Page() {
  return (
    <>
      <ProductHero
        eyebrow={"Performance"}
        title={"Cycles, goals, check-ins and 360 review aggregation."}
        lede={"Review cycles with participants, competency ratings, goals with check-ins over time, and 360 aggregation across reviewers. Available on the Professional plan."}
      />
      <PlaceholderNote topic={"performance"} related={"the platform overview"} />
    </>
  );
}
