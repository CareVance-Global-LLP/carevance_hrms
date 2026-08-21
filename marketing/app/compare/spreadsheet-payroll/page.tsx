import type { Metadata } from 'next';
import { ProductHero, PlaceholderNote } from '@/components/product/PageParts';

export const metadata: Metadata = {
  title: "Moving off spreadsheet payroll",
  description: "What changes when payroll stops being a spreadsheet: statutory computation, an audit trail, and returns generated rather than assembled.",
  alternates: { canonical: "/compare/spreadsheet-payroll" },
};

export default function Page() {
  return (
    <>
      <ProductHero
        eyebrow={"Comparison"}
        title={"The most common thing we replace is a spreadsheet."}
        lede={"Not a competitor — a workbook with a tab per month, a formula someone wrote in 2021, and a single person who understands it. This page will set out what actually changes, and where a spreadsheet is genuinely still fine."}
      />
      <PlaceholderNote topic={"spreadsheet comparison"} related={"the payroll page"} />
    </>
  );
}
