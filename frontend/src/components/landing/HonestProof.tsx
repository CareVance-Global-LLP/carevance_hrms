import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Reveal } from './Reveal';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * §11 — social proof, the honest version.
 *
 * WHY THERE IS NO NAME, NO PHOTO AND NO SIGNATURE ON THIS LETTER YET.
 *
 * The brief asks for a founder letter, and a founder letter is the right shape:
 * on a page with no logo wall it is the strongest thing available. But a letter
 * needs a real person's name against it, and inventing one — or signing it
 * "The CareVance Team" while dressing it as a personal note — is the same
 * category of thing as the 4.8-star rating and the eight fake logos that Phase 1
 * deleted from this page. A prospect who searches the name and finds nobody has
 * learned something worse than "this company is early".
 *
 * So the letter says the true thing in the first person plural, and the byline
 * is a slot.
 *
 * ===================================================================
 * TODO(founder): replace SIGNATORY below with the real name and role,
 * add the photo, and switch `signed` to true. Until then this renders
 * without a byline rather than with a fabricated one.
 * ===================================================================
 *
 * The design-partner card is the ask. "No customers yet" is only a weakness if
 * nothing is offered in its place; being early is genuinely worth something to
 * the right buyer, and this names what they get for it.
 *
 * The one attention effect on this page is the soft pulse on that card — 3s,
 * infinite, and the only looping animation anywhere on the landing page. It is
 * spent here because this is the single conversion the section exists for.
 */

const SIGNATORY: { name: string; role: string; signed: boolean } = {
  name: '',
  role: '',
  signed: false,
};

const OFFER = [
  'Direct access to the people building it, not a support tier',
  'Your statutory edge cases prioritised — the ones your current vendor calls "not supported"',
  'A parallel run against your existing payroll before you move a rupee',
  'Pricing held for the length of the engagement',
];

export default function HonestProof() {
  const reduced = usePrefersReducedMotion();

  return (
    <section className="bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] lg:gap-14">
          {/* ── The letter ───────────────────────────────────────── */}
          <Reveal>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
              Where we actually are
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
              We don’t have a logo wall, and we’re not going to borrow one.
            </h2>

            <div className="mt-6 space-y-4 text-[15px] leading-7 text-slate-600">
              <p>
                Most pages in this category open with customer counts, review badges and a row of
                logos. We are early enough that ours would be invented, so this page carries the
                things that can be checked instead: the statutory formats the engine actually
                writes, the rules it applies, and the arithmetic behind a payslip you can follow
                from a tracked minute to a bank file.
              </p>
              <p>
                What that means for you honestly: we have no SOC 2 report, no ISO 27001
                certificate, and no published uptime figure. If your procurement process requires
                one of those, we cannot satisfy it today — and you should learn that here rather
                than in week three of an evaluation.
              </p>
              <p>
                What you get in exchange for being early is the part that is hard to buy later:
                influence over what gets built, and a payroll engine whose authors will take your
                edge case personally.
              </p>
            </div>

            {SIGNATORY.signed ? (
              <div className="mt-6 flex items-center gap-3">
                <div>
                  <p className="text-sm font-bold text-slate-900">{SIGNATORY.name}</p>
                  <p className="text-[13px] text-slate-500">{SIGNATORY.role}</p>
                </div>
              </div>
            ) : (
              // Renders nothing rather than a placeholder byline. See the note
              // at the top of this file: an unsigned true statement is fine, a
              // signed invented one is not.
              null
            )}

            <p className="mt-6 text-[13px] leading-5 text-slate-400">
              Every number on this page traces to a line in PRODUCT_TRUTH.md, which names the file
              it was counted from.
            </p>
          </Reveal>

          {/* ── The ask ──────────────────────────────────────────── */}
          <Reveal delay={0.1}>
            <motion.div
              className="rounded-2xl border border-blue-200 bg-blue-50 p-6 sm:p-7"
              animate={
                reduced
                  ? undefined
                  : { boxShadow: [
                      '0 0 0 0 rgba(93,150,157,0)',
                      '0 0 0 10px rgba(93,150,157,0.10)',
                      '0 0 0 0 rgba(93,150,157,0)',
                    ] }
              }
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
                Design partner programme
              </p>
              <h3 className="mt-3 text-xl font-bold leading-snug text-blue-950">
                We are taking on a small number of design partners.
              </h3>
              <ul className="mt-5 grid gap-2.5">
                {OFFER.map((line) => (
                  <li key={line} className="flex gap-2.5 text-[13.5px] leading-6 text-blue-900">
                    <span
                      className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600"
                      aria-hidden="true"
                    />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>

              <Link
                to="/contact"
                className="mt-6 inline-flex h-11 items-center gap-2 rounded-lg bg-blue-700 px-5 text-sm font-semibold text-white transition-colors hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                Apply to be a design partner
                <ArrowRight className="h-4 w-4" />
              </Link>

              <p className="mt-3 text-[12px] leading-4 text-blue-800/70">
                We will tell you within a week either way, and we will tell you if you are a bad
                fit rather than run a discovery call to find out.
              </p>
            </motion.div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
