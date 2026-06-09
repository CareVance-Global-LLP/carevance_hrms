import { useState } from 'react';
import { Check, Minus } from 'lucide-react';
import { motion } from 'framer-motion';
import { featureCategories, PlanType } from '@/constants/pricing';
import SectionHeading from './SectionHeading';
import { fadeSlideUp, viewportOptions } from './animations';

type PlanKey = 'basic_tracking' | 'advance_tracking' | 'basic_payroll' | 'professional_payroll';

const trackingColumns: { key: PlanKey; label: string; sublabel: string }[] = [
  { key: 'basic_tracking', label: 'Basic', sublabel: 'Tracking' },
  { key: 'advance_tracking', label: 'Advance', sublabel: 'Tracking' },
];

const payrollColumns: { key: PlanKey; label: string; sublabel: string }[] = [
  { key: 'basic_payroll', label: 'Basic', sublabel: 'Tracker + Payroll' },
  { key: 'professional_payroll', label: 'Professional', sublabel: 'Tracker + Payroll' },
];

function Cell({ present }: { present: boolean | 'limited' }) {
  if (present === true) {
    return (
      <span className="mx-auto flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
        <Check className="h-3 w-3" />
      </span>
    );
  }
  if (present === 'limited') {
    return <span className="mx-auto text-center text-[11px] font-semibold uppercase tracking-wider text-amber-600">Limited</span>;
  }
  return (
    <span className="mx-auto flex h-5 w-5 items-center justify-center text-slate-300">
      <Minus className="h-3.5 w-3.5" />
    </span>
  );
}

export default function FeatureComparison() {
  const [activeTab, setActiveTab] = useState<PlanType>('tracking');
  const columns = activeTab === 'tracking' ? trackingColumns : payrollColumns;

  return (
    <section className="bg-[#f3f6fb] px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          eyebrow="Compare plans"
          title="Feature-by-feature comparison"
          description="See exactly what's included in each plan tier."
        />

        {/* Tab toggle */}
        <div className="mt-8 flex justify-center">
          <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
            {(['tracking', 'payroll'] as PlanType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setActiveTab(type)}
                className={`rounded-md px-5 py-2 text-sm font-semibold transition ${
                  activeTab === type
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {type === 'tracking' ? 'Tracking Plans' : 'Payroll Plans'}
              </button>
            ))}
          </div>
        </div>

        <motion.div
          key={activeTab}
          variants={fadeSlideUp}
          initial="hidden"
          animate="visible"
          viewport={viewportOptions}
          className="mt-8 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm"
        >
          <table className="w-full min-w-[600px] border-collapse">
            <thead>
              <tr>
                <th className="border-b border-slate-200 bg-slate-50 px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 w-[40%]">
                  Feature
                </th>
                {columns.map((col) => (
                  <th key={col.key} className="border-b border-slate-200 bg-slate-50 px-4 py-3.5 text-center">
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-900">{col.label}</p>
                    <p className="text-[10px] font-medium text-slate-400 mt-0.5">{col.sublabel}</p>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {featureCategories.map((section) => {
                const visibleFeatures = section.features.filter((f) =>
                  columns.some((col) => f[col.key])
                );
                if (visibleFeatures.length === 0) return null;

                return [
                  <tr key={`header-${section.category}`}>
                    <td
                      colSpan={columns.length + 1}
                      className="bg-gradient-to-r from-slate-50 to-transparent px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400"
                    >
                      {section.category}
                    </td>
                  </tr>,
                  ...visibleFeatures.map((feat) => (
                    <tr key={feat.name} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 text-sm text-slate-700">{feat.name}</td>
                      {columns.map((col) => (
                        <td key={col.key} className="px-4 py-3 text-center">
                          <Cell present={feat[col.key]} />
                        </td>
                      ))}
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        </motion.div>
      </div>
    </section>
  );
}
