import type { Metadata } from 'next';
import { ProductHero, PlaceholderNote } from '@/components/product/PageParts';

export const metadata: Metadata = {
  title: "About CareVance",
  description: "Who builds CareVance, and why it is built this way.",
  alternates: { canonical: "/about" },
};

export default function Page() {
  return (
    <>
      <ProductHero
        eyebrow={"About"}
        title={"Built by people who have run Indian payroll."}
        lede={"The design decisions on this site — refusing an impossible override rather than accepting it, showing the engine value beside the applied one, publishing what is not built — all come from the same place. This page will say who, and why."}
      />
      <PlaceholderNote topic={"about page"} related={"the “why CareVance” page"} />
    </>
  );
}
