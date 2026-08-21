import type { Metadata } from 'next';
import { ProductHero, PlaceholderNote } from '@/components/product/PageParts';

export const metadata: Metadata = {
  title: "Leave",
  description: "Leave requests, approvals with forwarding, balances, holiday calendars and encashment into payroll.",
  alternates: { canonical: "/product/leave" },
};

export default function Page() {
  return (
    <>
      <ProductHero
        eyebrow={"Leave"}
        title={"Requests, approvals that can be forwarded, and encashment into payroll."}
        lede={"Leave requests approve, reject, revoke and — unusually — transfer to a different approver when the right person to decide is not the default one. Balances and holiday calendars are per organisation, and encashment flows into the payroll run with its own approval. Leave is a flat annual quota today: there is no accrual schedule and no mid-year pro-rating, and this page will say so in full when it is written."}
      />
      <PlaceholderNote topic={"leave"} related={"the payroll page"} />
    </>
  );
}
