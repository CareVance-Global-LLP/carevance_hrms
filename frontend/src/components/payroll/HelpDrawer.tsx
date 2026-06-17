import { useState } from 'react';
import { X, HelpCircle, BookOpen, Calendar, FileText, Calculator, Users, ChevronRight, Sparkles, MessageSquare, Phone } from 'lucide-react';
import Button from '@/components/ui/Button';

interface HelpDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

const SECTIONS = [
  {
    id: 'first-time',
    icon: Sparkles,
    title: 'First time? Start here',
    description: 'A 3-step guided setup that takes ~5 minutes',
  },
  {
    id: 'glossary',
    icon: BookOpen,
    title: 'Glossary',
    description: 'PF, ESI, CTC, Gross, Net, TDS, PT — what do they mean?',
  },
  {
    id: 'how-to-process',
    icon: Calculator,
    title: 'How to process payroll',
    description: '5-step visual guide for your monthly run',
  },
  {
    id: 'compliance',
    icon: Calendar,
    title: 'Compliance deadlines',
    description: 'When PF, ESI, PT, TDS need to be filed',
  },
  {
    id: 'faqs',
    icon: HelpCircle,
    title: 'Frequently asked questions',
    description: 'Common questions answered',
  },
];

const GLOSSARY = [
  { term: 'CTC (Cost to Company)', desc: 'Total annual package including all benefits, taxes paid by employer, and employee deductions. The headline number in offer letters.' },
  { term: 'Gross Salary', desc: 'Monthly salary before any deductions. Sum of Basic + HRA + Allowances.' },
  { term: 'Net / Take-Home', desc: 'What hits the employee\'s bank account = Gross minus all deductions (PF, ESI, PT, TDS).' },
  { term: 'PF (Provident Fund)', desc: '12% of Basic Salary. Both employee and employer contribute. Employee can claim for tax benefit under 80C.' },
  { term: 'ESI (Employee State Insurance)', desc: 'Health insurance for employees earning ≤ ₹21,000/month. 0.75% employee + 3.25% employer.' },
  { term: 'PT (Professional Tax)', desc: 'State-level tax deducted from salary. Amount varies by state (₹0 to ₹200/month).' },
  { term: 'TDS (Tax Deducted at Source)', desc: 'Income tax deducted monthly based on annual projection. Adjusted at year-end during ITR filing.' },
  { term: 'LOP (Loss of Pay)', desc: 'Days the employee didn\'t work without approved leave. Salary is deducted pro-rata.' },
  { term: 'LWF (Labour Welfare Fund)', desc: 'Small annual contribution per state (₹10-100). Required in some states.' },
  { term: 'Gratuity', desc: 'Lump sum paid after 5 years of service. Formula: (Basic × 15) ÷ 26 × years of service.' },
  { term: 'Form 16', desc: 'Annual TDS certificate issued by employer. Used for filing Income Tax Return.' },
  { term: 'Form 12BB', desc: 'Employee declaration of tax-saving investments. Reduces TDS deduction.' },
];

const HOW_TO_PROCESS = [
  { step: 1, title: 'Go to Payroll Dashboard', desc: 'Click on a department that has pending employees.' },
  { step: 2, title: 'Select employees', desc: 'Tick the checkbox next to each employee you want to process.' },
  { step: 3, title: 'Set CTC if missing', desc: 'If an employee has no CTC, click "Set CTC & Process" to enter it first.' },
  { step: 4, title: 'Click "Process Selected"', desc: 'The system calculates PF, ESI, PT, TDS based on their template.' },
  { step: 5, title: 'Review and approve', desc: 'Lock the run → Approve → Release → Process Payment.' },
];

const COMPLIANCE_DEADLINES = [
  { form: 'PF ECR', deadline: '15th of next month', desc: 'EPFO monthly contribution' },
  { form: 'ESI Challan', deadline: '15th of next month', desc: 'ESIC monthly contribution' },
  { form: 'PT Return', deadline: 'Varies by state (usually 15-30th)', desc: 'State professional tax' },
  { form: 'TDS Form 24Q', deadline: '15 days from quarter end', desc: 'Quarterly TDS on salary' },
  { form: 'Form 16', deadline: '15 June (post-FY)', desc: 'Annual TDS certificate to employee' },
  { form: 'LWF', deadline: 'Varies by state', desc: 'Annual labour welfare fund' },
];

const FAQS = [
  { q: 'My employee has no CTC yet. How do I add one?', a: 'In Payroll Dashboard, click a department, then click "Set CTC & Process" on an employee card. You can also do this in bulk from the department view.' },
  { q: 'How do I undo a payroll run?', a: 'You can\'t delete a paid/released run (immutability for compliance). If it\'s still in draft/locked/approved state, you can re-process to update values.' },
  { q: 'What\'s the difference between LOP and unpaid leave?', a: 'LOP is just the salary calculation impact (deduction for absent days). Unpaid leave is the HR/leave system term. They result in the same salary effect.' },
  { q: 'How is monthly TDS calculated?', a: 'Annual tax is projected from current month\'s income × 12, minus any approved exemptions (Form 12BB). Then divided by 12 for monthly TDS.' },
  { q: 'Can I generate Form 16 for a specific employee?', a: 'Yes. Go to Advanced Payroll → Filings → Form 16 tab. Select the employee and financial year.' },
];

export default function HelpDrawer({ isOpen, onClose }: HelpDrawerProps) {
  const [activeSection, setActiveSection] = useState<string>('first-time');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close help"
      />
      <div className="relative bg-white w-full max-w-2xl h-full overflow-y-auto shadow-2xl">
        {/* Header */}
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
          {/* Sidebar nav */}
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

          {/* Content */}
          <div className="flex-1 p-6">
            {activeSection === 'first-time' && (
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-slate-900">First time? Start here</h3>
                <p className="text-sm text-slate-600">Your fastest path to a working payroll:</p>
                <ol className="space-y-3 mt-4">
                  {HOW_TO_PROCESS.map(s => (
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
                    💡 <strong>Tip:</strong> When you first open Payroll, you'll see a "Get Started" card. Click "Start 3-step setup" for a guided tour.
                  </p>
                </div>
              </div>
            )}

            {activeSection === 'glossary' && (
              <div className="space-y-4">
                <h3 className="text-xl font-bold text-slate-900">Glossary</h3>
                <p className="text-sm text-slate-600">Common Indian payroll terms explained.</p>
                <div className="space-y-3 mt-4">
                  {GLOSSARY.map(g => (
                    <div key={g.term} className="border-b border-slate-100 pb-3 last:border-0">
                      <p className="font-semibold text-slate-900">{g.term}</p>
                      <p className="text-sm text-slate-600 mt-1">{g.desc}</p>
                    </div>
                  ))}
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
                  {FAQS.map((f, idx) => (
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

            {/* Footer support */}
            <div className="mt-8 pt-6 border-t border-slate-200 space-y-3">
              <h4 className="text-sm font-semibold text-slate-700">Still need help?</h4>
              <div className="flex flex-col gap-2">
                <a
                  href="mailto:support@carevance.com"
                  className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-2"
                >
                  <MessageSquare className="h-4 w-4" />
                  support@carevance.com
                </a>
                <a
                  href="tel:+911234567890"
                  className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-2"
                >
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
