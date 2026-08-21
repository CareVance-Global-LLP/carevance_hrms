import type { Metadata } from 'next';
import { ProductHero, PlaceholderNote } from '@/components/product/PageParts';

export const metadata: Metadata = {
  title: "Changelog",
  description: "What shipped, and when.",
  alternates: { canonical: "/changelog" },
};

export default function Page() {
  return (
    <>
      <ProductHero
        eyebrow={"Changelog"}
        title={"What shipped, and when."}
        lede={"A public record of releases. For a young product this is the most honest liveness signal available — more useful than a logo wall, and harder to fake."}
      />
      <PlaceholderNote topic={"changelog"} related={"the platform overview"} />
    </>
  );
}
