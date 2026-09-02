import { useId, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import SectionHeading from './SectionHeading';
import { easeOut } from './animations';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * §9 — per-role tabs. HRMS is a committee purchase.
 *
 * Five people in the room and each one is buying something different. A founder
 * wants the cost of the whole thing; a payroll admin wants to know whether the
 * arithmetic can be audited; an employee wants their payslip on their phone. A
 * single feature list serves none of them, which is why this pattern beats a
 * ten-row alternating stack.
 *
 * REAL ARIA TABS, not styled buttons: roving tabindex, arrow-key navigation,
 * Home/End, and `aria-controls` pointing at a labelled panel. A tab strip that
 * cannot be driven from the keyboard is a carousel wearing a costume.
 *
 * THE PILL IS A SHARED LAYOUT TRANSITION. One `layoutId`, rendered inside
 * whichever tab is active — framer sees the same identity mount in a new place
 * and animates the difference, so the element physically travels rather than a
 * separate absolutely-positioned bar being told where to go. It re-measures on
 * every layout change by construction, which a hand-measured transform does not.
 *
 * THE PANEL SWAP IS DIRECTION-AWARE. Content enters from the side the reader
 * came from. A swap that always animates the same way tells them nothing about
 * where they are in the strip.
 *
 * The panel height is RESERVED with a min-height: swapping content of different
 * heights is the most common source of layout shift on a marketing page.
 */

interface Role {
  key: string;
  label: string;
  headline: string;
  body: string;
  points: ReadonlyArray<{ text: string; claim: string }>;
}

const ROLES: readonly Role[] = [
  {
    key: 'founder',
    label: 'Founder',
    headline: 'One bill, and the cost of a head before you hire it.',
    body: 'The whole workforce stack on one contract, priced in the open. Burn rate and CTC planning across the org, so a hiring decision has a number attached before it is made.',
    points: [
      { text: 'Published pricing, and a calculator that shows your real per-employee cost', claim: 'PRC-01' },
      { text: 'Burn rate and CTC planning across the organisation', claim: 'RPT-04' },
      { text: 'Multiple legal entities, each with its own PAN, TAN, PF and ESI codes', claim: 'ENT-01' },
    ],
  },
  {
    key: 'hr',
    label: 'HR',
    headline: 'From an accepted offer to a final settlement.',
    body: 'Hiring opens an onboarding journey automatically — an eighteen-step checklist spanning day −14 to +90 across six owner roles, with blocking gates. Exit runs the same machinery in reverse.',
    points: [
      { text: 'Checklist items complete themselves from evidence, not from a click', claim: 'HR-03' },
      { text: 'Future joining dates are valid — pre-boarding is the normal path', claim: 'HR-04' },
      { text: 'Leave accrues per type, and a balance is a ledger you can expand', claim: 'LVA-01' },
    ],
  },
  {
    key: 'payroll',
    label: 'Payroll admin',
    headline: 'Every rupee can name the rule that put it there.',
    body: 'A run moves through draft, locked, approved, released and disbursed, each stage stamped. Overrides carry the engine value beside the applied one, so a number can always be explained.',
    points: [
      { text: 'Raising Basic by ₹1 costs ₹1.668 — and the product says so before you commit', claim: 'OVR-02' },
      { text: 'A value that cannot balance is refused at entry, with the maximum that would work', claim: 'OVR-01' },
      { text: 'Negative net pay is surfaced for validation, never clamped to zero', claim: 'PAY-08' },
    ],
  },
  {
    key: 'manager',
    label: 'Manager',
    headline: 'Approvals that reach you, and evidence when you need it.',
    body: 'Leave, overtime, regularisation and comp-off approvals in one inbox, on the web or the phone. A request can be forwarded to the person who actually has the context.',
    points: [
      { text: 'Regularisation requests approve, reject, and forward to another approver', claim: 'TIM-08' },
      { text: 'Team presence, and the roster the attendance was measured against', claim: 'TIM-10' },
      { text: 'A shift swap needs the counterparty AND a manager — nothing moves before that', claim: 'ROS-08' },
    ],
  },
  {
    key: 'employee',
    label: 'Employee',
    headline: 'Your hours, your payslip, your leave — on your phone.',
    body: 'Punch in with a selfie and a geofence, see the attendance that was recorded, request leave against a balance you can expand into the dated rows that produced it, and read your own payslip.',
    points: [
      { text: 'A joiner sees and completes only their own checklist items', claim: 'HR-03' },
      { text: 'Consent per capture type, withdrawable — and withdrawal is honoured', claim: 'CON-03' },
      { text: 'Salary revision letters are accepted or rejected by the employee', claim: 'HR-07' },
    ],
  },
];

export default function RoleTabs() {
  const [active, setActive] = useState(0);
  const direction = useRef(1);
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const reduced = usePrefersReducedMotion();

  const select = (next: number) => {
    direction.current = next > active ? 1 : -1;
    setActive(next);
  };

  const focusTab = (i: number) => {
    const next = (i + ROLES.length) % ROLES.length;
    select(next);
    tabRefs.current[next]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        focusTab(active + 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        focusTab(active - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusTab(0);
        break;
      case 'End':
        e.preventDefault();
        focusTab(ROLES.length - 1);
        break;
    }
  };

  const current = ROLES[active];
  const enterX = reduced ? 0 : direction.current * 24;
  const exitX = reduced ? 0 : direction.current * -24;

  return (
    <section className="bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <SectionHeading
          eyebrow="Every seat in the room"
          title="HRMS is a committee purchase. Everyone in the room gets a reason."
          align="left"
        />

        <div className="mt-10">
          <div
            role="tablist"
            aria-label="What each role gets"
            onKeyDown={onKeyDown}
            className="relative flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm"
          >
            {ROLES.map((role, i) => (
              <button
                key={role.key}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${role.key}`}
                aria-selected={i === active}
                aria-controls={`${baseId}-panel-${role.key}`}
                // Roving tabindex: one stop for the strip, arrows move within.
                tabIndex={i === active ? 0 : -1}
                onClick={() => select(i)}
                className={`relative flex-1 rounded-lg px-3 py-2.5 text-[13.5px] font-semibold whitespace-nowrap transition-colors ${
                  i === active ? 'text-white' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {i === active && (
                  <motion.span
                    layoutId={`${baseId}-role-pill`}
                    aria-hidden="true"
                    className="absolute inset-0 rounded-lg bg-blue-700"
                    transition={
                      reduced ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 36 }
                    }
                  />
                )}
                <span className="relative z-10">{role.label}</span>
              </button>
            ))}
          </div>

          {/* Reserved height, so a swap never moves the page. */}
          <div className="relative mt-8 min-h-[19rem] sm:min-h-[15rem]">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={current.key}
                role="tabpanel"
                id={`${baseId}-panel-${current.key}`}
                aria-labelledby={`${baseId}-tab-${current.key}`}
                tabIndex={0}
                initial={reduced ? false : { opacity: 0, x: enterX }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduced ? undefined : { opacity: 0, x: exitX }}
                transition={{ duration: reduced ? 0 : 0.28, ease: easeOut }}
                className="focus-visible:outline-none"
              >
                <h3 className="text-xl font-bold leading-tight text-slate-900">
                  {current.headline}
                </h3>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500">{current.body}</p>
                <ul className="mt-5 grid gap-2.5 sm:grid-cols-3">
                  {current.points.map((p) => (
                    <li
                      key={p.text}
                      data-claim={p.claim}
                      className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-[13px] leading-6 text-slate-600"
                    >
                      {p.text}
                    </li>
                  ))}
                </ul>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
