import type { Metadata } from 'next';
import { ProductHero, PlaceholderNote } from '@/components/product/PageParts';

export const metadata: Metadata = {
  title: "Mobile & desktop apps",
  description: "The Expo mobile app, the Electron desktop tracker and the Chromium browser extension.",
  alternates: { canonical: "/product/mobile" },
};

export default function Page() {
  return (
    <>
      <ProductHero
        eyebrow={"Apps"}
        title={"Four surfaces, because the work does not all happen in a browser tab."}
        lede={"An 18-screen mobile app covering payslips, leave, attendance, comp-off, regularisation and a manager approval inbox. An Electron desktop tracker with screenshots, OS-level idle detection and an offline disk queue. A Chromium extension supplying URL context. And the web application behind all of them."}
      />
      <PlaceholderNote topic={"mobile and desktop apps"} related={"the time and attendance page"} />
    </>
  );
}
