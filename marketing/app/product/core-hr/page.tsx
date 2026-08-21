import type { Metadata } from 'next';
import { ProductHero, PlaceholderNote } from '@/components/product/PageParts';

export const metadata: Metadata = {
  title: "Core HR",
  description: "Employee records, documents, government IDs, onboarding journeys and the exit lifecycle — built, with a marketing page still being written.",
  alternates: { canonical: "/product/core-hr" },
};

export default function Page() {
  return (
    <>
      <ProductHero
        eyebrow={"Core HR"}
        title={"Records, onboarding journeys and exit — one lifecycle."}
        lede={"Hiring opens an 18-step onboarding checklist automatically, spanning day −14 to +90 across six owner roles with blocking gates. Exit runs the same machinery in reverse: notice period, checklist, access revocation, interview, full and final settlement."}
      />
      <PlaceholderNote topic={"core HR"} related={"the platform overview"} />
    </>
  );
}
