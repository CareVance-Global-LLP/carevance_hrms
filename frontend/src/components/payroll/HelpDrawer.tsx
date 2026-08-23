import { useState } from 'react';
import { X, HelpCircle } from 'lucide-react';
import SlideOver from '@/components/ui/dialog/SlideOver';

interface HelpDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

const FAQS = [
  {
    q: 'How does payroll processing work?',
    a: 'Payroll runs through 6 stages: Draft → Processing → Locked → Approved → Released → Disbursed. Each stage has specific actions and approvals required before progression.',
  },
  { q: 'What is a Pay Group?', a: 'A Pay Group is a named collection of employees who share the same pay schedule, frequency, and processing rules. All employees in a group are processed together.' },
  { q: 'How is TDS calculated?', a: 'Annual tax is projected from current income × 12, minus exemptions from Form 12BB, then divided by 12 for monthly TDS. Adjusted at year-end via Form 16 / ITR.' },
];

const GLOSSARY = [
  { term: 'CTC', def: 'Cost to Company — total annual employer spend per employee including salary + benefits + statutory contributions.' },
  { term: 'LOP', def: 'Loss of Pay — deduction for days absent beyond approved leave balance.' },
  { term: 'ECR', def: 'Electronic Challan cum Return — monthly PF filing submitted to EPFO.' },
];

/*
 * A REFERENCE list, not a status list.
 *
 * These carried a pass/fail flag and rendered a red cross against TDS on every
 * tenant, forever - inventing a compliance breach on a compliance product, in
 * a drawer reachable from all six payroll tabs. Whether a filing is actually
 * late is a question only the filing rows can answer, and the Filings screen
 * answers it there. This says what the statute requires, and nothing more.
 *
 * ESI also read "21st"; reg. 31 of the ESI (General) Regulations 1950 gives
 * the 15th of the following month.
 */
const DEADLINES = [
  { text: 'PF ECR — 15th of the following month', law: 'EPF Scheme 1952, para 38' },
  { text: 'ESI contribution — 15th of the following month', law: 'ESI (Gen.) Regs 1950, reg. 31' },
  { text: 'TDS deposit — 7th of the following month', law: 'IT Rules, r.30' },
  { text: 'Form 24Q — 31 Jul / 31 Oct / 31 Jan / 31 May', law: 'IT Rules, r.31A' },
  { text: 'Form 16 — 15 June', law: 'IT Rules, r.31' },
];

export default function HelpDrawer({ isOpen, onClose }: HelpDrawerProps) {
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  if (!isOpen) return null;

  return (
    <SlideOver open onClose={onClose} titleId="help-drawer-title" widthClassName="max-w-[420px]">
        <div className="sticky top-0 bg-white z-10 px-[22px] py-5 flex items-center justify-between border-b border-slate-200">
          <div id="help-drawer-title" className="text-[15px] font-bold text-slate-900">Help &amp; Resources</div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-[22px] py-[18px]">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2.5">
            How It Works
          </div>
          <div className="rounded-lg border border-slate-200 overflow-hidden mb-3.5">
            <button
              onClick={() => setOpenFaq(openFaq === 0 ? null : 0)}
              className="w-full px-3.5 py-3 bg-slate-50 flex items-center justify-between text-left cursor-pointer"
            >
              <span className="text-[13px] font-semibold text-slate-900">{FAQS[0].q}</span>
              <span className="text-slate-500 text-xs">{openFaq === 0 ? '▼' : '▶'}</span>
            </button>
            {openFaq === 0 && (
              <div className="px-3.5 py-3 text-[13px] text-slate-500 leading-relaxed">
                {FAQS[0].a}
              </div>
            )}
          </div>
          <div className="rounded-lg border border-slate-200 overflow-hidden mb-3.5">
            <button
              onClick={() => setOpenFaq(openFaq === 1 ? null : 1)}
              className="w-full px-3.5 py-3 bg-slate-50 flex items-center justify-between text-left cursor-pointer"
            >
              <span className="text-[13px] font-semibold text-slate-900">{FAQS[1].q}</span>
              <span className="text-slate-500 text-xs">{openFaq === 1 ? '▼' : '▶'}</span>
            </button>
            {openFaq === 1 && (
              <div className="px-3.5 py-3 text-[13px] text-slate-500 leading-relaxed">
                {FAQS[1].a}
              </div>
            )}
          </div>
          <div className="rounded-lg border border-slate-200 overflow-hidden mb-4.5">
            <button
              onClick={() => setOpenFaq(openFaq === 2 ? null : 2)}
              className="w-full px-3.5 py-3 bg-slate-50 flex items-center justify-between text-left cursor-pointer"
            >
              <span className="text-[13px] font-semibold text-slate-900">{FAQS[2].q}</span>
              <span className="text-slate-500 text-xs">{openFaq === 2 ? '▼' : '▶'}</span>
            </button>
            {openFaq === 2 && (
              <div className="px-3.5 py-3 text-[13px] text-slate-500 leading-relaxed">
                {FAQS[2].a}
              </div>
            )}
          </div>

          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2.5">
            Glossary
          </div>
          <div className="flex flex-col gap-2 mb-4">
            {GLOSSARY.map((g) => (
              <div key={g.term} className="px-3 py-2.5 border border-slate-200 rounded-md">
                <div className="text-[12.5px] font-semibold text-slate-900">{g.term}</div>
                <div className="text-xs text-slate-500 mt-2 leading-relaxed">{g.def}</div>
              </div>
            ))}
          </div>

          <div className="h-px bg-slate-200 my-4" />

          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest mb-2.5">
            Statutory Deadlines
          </div>
          <p className="text-[12px] text-slate-500 mb-2">
            What the law requires. Whether your filings are on time is shown on Payroll &rarr; Tax
            &amp; Compliance &rarr; Statutory Filings, against your real filing records.
          </p>
          <div>
            {DEADLINES.map((d) => (
              <div key={d.text} className="py-2.5 border-b border-slate-200 last:border-b-0">
                <div className="text-[13px] text-slate-900">{d.text}</div>
                <div className="text-[11px] text-slate-500">{d.law}</div>
              </div>
            ))}
          </div>
        </div>
    </SlideOver>
  );
}
