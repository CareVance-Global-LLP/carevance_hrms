import { useState } from 'react';
import { X, HelpCircle, BookOpen, Calendar, FileText, Calculator, Users, ChevronRight, Sparkles, MessageSquare, Phone } from 'lucide-react';
import { PAYROLL_GLOSSARY, COMPLIANCE_DEADLINES, PAYROLL_FAQS, HOW_TO_PROCESS, getGlossaryBySection } from '@/data/payrollGlossary';

interface HelpDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  initialSection?: string;
}

const SECTIONS = [
  { id: 'first-time', icon: Sparkles, title: 'First time? Start here' },
  { id: 'how-to-process', icon: Calculator, title: 'How to process payroll' },
  { id: 'glossary', icon: BookOpen, title: 'Glossary' },
  { id: 'compliance', icon: Calendar, title: 'Compliance deadlines' },
  { id: 'faqs', icon: HelpCircle, title: 'Frequently asked questions' },
];

export default function HelpDrawer({ isOpen, onClose, initialSection }: HelpDrawerProps) {
  const [activeSection, setActiveSection] = useState<string>(initialSection ?? 'first-time');

  if (!isOpen) return null;

  const glossaryEntries = getGlossaryBySection('glossary');
  const featureEntries = getGlossaryBySection('feature');
  const runEntries = getGlossaryBySection('run');
  const complianceEntries = getGlossaryBySection('compliance');

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close help"
      />
      <div className="relative bg-white w-full max-w-2xl h-full overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-slate-200 p-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-blue-600" />
            Help & Guides
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg" aria-label="Close">
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <div className="flex flex-col md:flex-row">
          <nav className="md:w-56 border-r border-slate-200 p-3 bg-slate-50 md:min-h-[calc(100vh-65px)]">
            <ul className="space-y-1">
              {SECTIONS.map(s => {
                const Icon = s.icon;
                const isActive = activeSection === s.id;
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => setActiveSection(s.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg flex items-start gap-2 transition-colors ${
                        isActive ? 'bg-blue-100 text-blue-900' : 'hover:bg-slate-100 text-slate-700'
                      }`}
                    >
                      <Icon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{s.title}</p>
                      </div>
                      <ChevronRight className={`h-3 w-3 mt-1 ${isActive ? 'text-blue-600' : 'text-slate-300'}`} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="flex-1 p-6">
            {activeSection === 'first-time' && (
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-slate-900">First time? Start here</h3>
                <p className="text-sm text-slate-600">Your fastest path to a working payroll:</p>
                <ol className="space-y-3 mt-4">
                  {HOW_TO_PROCESS.slice(0, 4).map(s => (
                    <li key={s.step} className="flex gap-3">
                      <div className="h-7 w-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                        {s.step}
                      </div>
                      <div>
                        <p className="font-medium text-slate-900">{s.title}</p>
                        <p className="text-sm text-slate-600">{s.desc}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm text-blue-900">
                    Tip: When you first open Payroll, you\'ll see a "Get Started" card. Click "Start Setup" for a guided 9-step tour.
                  </p>
                </div>
              </div>
            )}

            {activeSection === 'how-to-process' && (
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-slate-900">How to process payroll</h3>
                <p className="text-sm text-slate-600">Monthly flow, from start to finish.</p>
                <div className="mt-4 space-y-4">
                  {HOW_TO_PROCESS.map(s => (
                    <div key={s.step} className="flex gap-4 p-4 bg-slate-50 rounded-lg">
                      <div className="h-10 w-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold flex-shrink-0">
                        {s.step}
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900">{s.title}</p>
                        <p className="text-sm text-slate-600 mt-1">{s.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeSection === 'glossary' && (
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-slate-900">Glossary</h3>
                <p className="text-sm text-slate-600">Common Indian payroll terms explained. Click any term on a payslip or setup page for a quick popup.</p>
                <div className="mt-4 space-y-5">
                  {glossaryEntries.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Salary structure</h4>
                      <div className="space-y-3">
                        {glossaryEntries.map(g => (
                          <GlossaryRow key={g.key} entry={g} />
                        ))}
                      </div>
                    </div>
                  )}
                  {complianceEntries.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Compliance identifiers</h4>
                      <div className="space-y-3">
                        {complianceEntries.map(g => (
                          <GlossaryRow key={g.key} entry={g} />
                        ))}
                      </div>
                    </div>
                  )}
                  {runEntries.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Run & disbursement</h4>
                      <div className="space-y-3">
                        {runEntries.map(g => (
                          <GlossaryRow key={g.key} entry={g} />
                        ))}
                      </div>
                    </div>
                  )}
                  {featureEntries.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Feature pages</h4>
                      <div className="space-y-3">
                        {featureEntries.map(g => (
                          <GlossaryRow key={g.key} entry={g} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeSection === 'compliance' && (
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-slate-900">Compliance deadlines</h3>
                <p className="text-sm text-slate-600">Stay on top of statutory filing dates.</p>
                <div className="mt-4 space-y-2">
                  {COMPLIANCE_DEADLINES.map(c => (
                    <div key={c.form} className="p-4 border border-slate-200 rounded-lg">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-slate-900">{c.form}</p>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 whitespace-nowrap">{c.deadline}</span>
                      </div>
                      <p className="text-sm text-slate-600 mt-1">{c.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeSection === 'faqs' && (
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-slate-900">Frequently asked questions</h3>
                <div className="mt-4 space-y-4">
                  {PAYROLL_FAQS.map((f, idx) => (
                    <details key={idx} className="p-4 border border-slate-200 rounded-lg group">
                      <summary className="font-medium text-slate-900 cursor-pointer flex items-center justify-between">
                        {f.q}
                        <ChevronRight className="h-4 w-4 text-slate-400 group-open:rotate-90 transition-transform" />
                      </summary>
                      <p className="text-sm text-slate-600 mt-2">{f.a}</p>
                    </details>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-8 pt-6 border-t border-slate-200 space-y-3">
              <h4 className="text-sm font-semibold text-slate-700">Still need help?</h4>
              <div className="flex flex-col gap-2">
                <a href="mailto:support@carevance.com" className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  support@carevance.com
                </a>
                <a href="tel:+911234567890" className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-2">
                  <Phone className="h-4 w-4" />
                  +91 12345 67890
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GlossaryRow({ entry }: { entry: { term: string; short: string; full: string; typical?: string } }) {
  return (
    <div className="border-b border-slate-100 pb-3 last:border-0">
      <p className="font-semibold text-slate-900">{entry.term}</p>
      <p className="text-sm text-slate-600 mt-1">{entry.full}</p>
      {entry.typical && (
        <p className="text-xs text-slate-500 mt-1">
          <span className="font-medium text-slate-700">Typical: </span>
          {entry.typical}
        </p>
      )}
    </div>
  );
}
