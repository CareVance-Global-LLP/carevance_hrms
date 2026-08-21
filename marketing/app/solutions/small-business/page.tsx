import type { Metadata } from 'next';
import { ProductHero, PlaceholderNote } from '@/components/product/PageParts';

export const metadata: Metadata = {
  title: "HR & payroll for small businesses in India",
  description: "Your first payroll system after the spreadsheet.",
  alternates: { canonical: "/solutions/small-business" },
};

export default function Page() {
  return (
    <>
      <ProductHero
        eyebrow={"Small business"}
        title={"Your first payroll system after the spreadsheet."}
        lede={"For most companies at this size the realistic alternative is not a rival platform — it is five disconnected tools and a shared drive. The statutory engine alone is usually the argument: PF, ESI, professional tax across 37 states, TDS on both regimes, and the returns generated rather than assembled."}
      />
      <PlaceholderNote topic={"small business"} related={"the pricing page"} />
    </>
  );
}
