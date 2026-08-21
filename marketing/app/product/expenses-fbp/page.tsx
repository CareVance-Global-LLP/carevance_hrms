import type { Metadata } from 'next';
import { ProductHero, PlaceholderNote } from '@/components/product/PageParts';

export const metadata: Metadata = {
  title: "Expenses & FBP",
  description: "Reimbursements with two-stage approval, flexible benefit plans, loans with payroll recovery, and variable pay.",
  alternates: { canonical: "/product/expenses-fbp" },
};

export default function Page() {
  return (
    <>
      <ProductHero
        eyebrow={"Expenses & benefits"}
        title={"Reimbursements, FBP, loans and variable pay — all landing in the run."}
        lede={"Reimbursements with receipt upload and a two-stage manager-then-admin approval. Flexible benefit components allocated per employee, with claims. Loans that recover through payroll on a schedule. Variable pay rules and assignments. Each of these ends in a payroll item rather than a spreadsheet."}
      />
      <PlaceholderNote topic={"expenses and benefits"} related={"the payroll page"} />
    </>
  );
}
