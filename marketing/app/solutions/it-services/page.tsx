import type { Metadata } from 'next';
import { ProductHero, PlaceholderNote } from '@/components/product/PageParts';

export const metadata: Metadata = {
  title: "HR & payroll for IT services firms",
  description: "Project time, utilisation and payroll in one ledger.",
  alternates: { canonical: "/solutions/it-services" },
};

export default function Page() {
  return (
    <>
      <ProductHero
        eyebrow={"IT services"}
        title={"Project time, utilisation and payroll from the same records."}
        lede={"Projects and tasks, tracked time classified by application and URL, and a payroll run that reads the same attendance. Utilisation stops being a number someone assembles at quarter end from three exports."}
      />
      <PlaceholderNote topic={"IT services"} related={"the platform overview"} />
    </>
  );
}
