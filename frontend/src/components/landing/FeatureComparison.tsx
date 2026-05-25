import { Check, Minus } from 'lucide-react';
import SectionHeading from './SectionHeading';

const planColumns = [
  { key: 'basic', label: 'Basic' },
  { key: 'advanced', label: 'Advanced' },
  { key: 'enterprise', label: 'Enterprise' },
] as const;

type PlanKey = (typeof planColumns)[number]['key'];

const rows: { category: string; features: { name: string; plans: Record<PlanKey, boolean | 'limited'> }[] }[] = [
  {
    category: 'Time Tracking',
    features: [
      { name: 'Desktop timer app', plans: { basic: true, advanced: true, enterprise: true } },
      { name: 'Check-in / check-out', plans: { basic: true, advanced: true, enterprise: true } },
      { name: 'Idle detection and auto-stop', plans: { basic: true, advanced: true, enterprise: true } },
      { name: 'Overtime calculation and history', plans: { basic: true, advanced: true, enterprise: true } },
      { name: 'Project tracking', plans: { basic: false, advanced: true, enterprise: true } },
      { name: 'Task tracking', plans: { basic: false, advanced: true, enterprise: true } },
    ],
  },
  {
    category: 'Monitoring & Screenshots',
    features: [
      { name: 'Screenshot capture and viewer history', plans: { basic: true, advanced: true, enterprise: true } },
      { name: 'Employee timeline', plans: { basic: false, advanced: true, enterprise: true } },
      { name: 'Geo-fencing', plans: { basic: false, advanced: true, enterprise: true } },
    ],
  },
  {
    category: 'Reports & Analytics',
    features: [
      { name: 'Reports module with CSV export', plans: { basic: true, advanced: true, enterprise: true } },
      { name: 'Custom reports and dashboards', plans: { basic: false, advanced: false, enterprise: true } },
    ],
  },
  {
    category: 'Workforce Management',
    features: [
      { name: 'User and role management', plans: { basic: true, advanced: true, enterprise: true } },
      { name: 'Approval workflow', plans: { basic: true, advanced: true, enterprise: true } },
      { name: 'Workspace onboarding and invites', plans: { basic: true, advanced: true, enterprise: true } },
      { name: 'Multi-role access', plans: { basic: true, advanced: true, enterprise: true } },
      { name: 'Chat module', plans: { basic: false, advanced: true, enterprise: true } },
      { name: 'Leave application and approval workflow', plans: { basic: false, advanced: true, enterprise: true } },
    ],
  },
  {
    category: 'Support & Onboarding',
    features: [
      { name: 'Email support', plans: { basic: true, advanced: true, enterprise: true } },
      { name: 'Priority support', plans: { basic: false, advanced: true, enterprise: true } },
      { name: 'Custom rollout and onboarding support', plans: { basic: false, advanced: false, enterprise: true } },
      { name: 'Flexible billing and procurement support', plans: { basic: false, advanced: false, enterprise: true } },
    ],
  },
];

function Cell({ present }: { present: boolean | 'limited' }) {
  if (present === true) {
    return (
      <span className="mx-auto flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-blue-700">
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
  return (
    <section className="bg-[#f3f6fb] px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          eyebrow="Compare plans"
          title="Everything you need to compare at a glance"
          description="See exactly which features are available in each plan."
        />

        <div className="mt-10 overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[500px] border-collapse">
            <thead>
              <tr>
                <th className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Feature</th>
                {planColumns.map((col) => (
                  <th key={col.key} className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-900">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.flatMap((section) => [
                <tr key={section.category}>
                  <td colSpan={planColumns.length + 1} className="bg-slate-50/50 px-3 py-2.5 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 sm:px-4">
                    {section.category}
                  </td>
                </tr>,
                ...section.features.map((feat) => (
                  <tr key={feat.name} className="border-b border-slate-100 last:border-b-0">
                    <td className="px-3 py-3 text-xs text-slate-700 sm:px-4 sm:text-sm">{feat.name}</td>
                    {planColumns.map((col) => (
                      <td key={col.key} className="px-3 py-3 text-center sm:px-4">
                        <Cell present={feat.plans[col.key]} />
                      </td>
                    ))}
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
