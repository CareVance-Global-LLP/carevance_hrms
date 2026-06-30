import { useState } from 'react';
import { ChevronDown, ChevronUp, Lightbulb, Calendar, AlertTriangle, ArrowRight } from 'lucide-react';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { cn } from '@/utils/cn';

interface HowItWorksCardProps {
  title?: string;
  intro?: string;
  whatIsThis?: string;
  whenToUse?: string[];
  howItFlows?: Array<{ step: number; label: string; desc?: string }>;
  commonMistakes?: string[];
  defaultOpen?: boolean;
  className?: string;
}

/**
 * Educational "How this works" card for feature pages.
 * Collapsed by default to keep dashboards clean; expands to reveal
 * What / When / How / Mistakes sections.
 */
export default function HowItWorksCard({
  title = 'How this works',
  intro,
  whatIsThis,
  whenToUse,
  howItFlows,
  commonMistakes,
  defaultOpen = false,
  className,
}: HowItWorksCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  const hasContent = !!(whatIsThis || whenToUse?.length || howItFlows?.length || commonMistakes?.length);

  if (!hasContent) return null;

  return (
    <SurfaceCard className={cn('overflow-hidden border-blue-200', className)}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-4 bg-blue-50/60 hover:bg-blue-50 transition-colors text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-7 w-7 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">
            <Lightbulb className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">{title}</p>
            {intro && <p className="text-xs text-slate-500 truncate">{intro}</p>}
          </div>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-slate-500 flex-shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-slate-500 flex-shrink-0" />
        )}
      </button>

      {open && (
        <div className="p-5 space-y-5 border-t border-blue-100 bg-white">
          {whatIsThis && (
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">What is this?</h4>
              <p className="text-sm text-slate-700 leading-relaxed">{whatIsThis}</p>
            </section>
          )}

          {whenToUse && whenToUse.length > 0 && (
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" /> When to use it
              </h4>
              <ul className="space-y-1.5">
                {whenToUse.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                    <ArrowRight className="h-3.5 w-3.5 text-blue-500 mt-0.5 flex-shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {howItFlows && howItFlows.length > 0 && (
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">How it flows</h4>
              <ol className="space-y-2">
                {howItFlows.map((s) => (
                  <li key={s.step} className="flex items-start gap-3">
                    <div className="h-6 w-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-semibold flex-shrink-0 mt-0.5">
                      {s.step}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-900">{s.label}</p>
                      {s.desc && <p className="text-xs text-slate-600">{s.desc}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {commonMistakes && commonMistakes.length > 0 && (
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> Common mistakes
              </h4>
              <ul className="space-y-1.5">
                {commonMistakes.map((m, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                    <span className="text-amber-500 flex-shrink-0">•</span>
                    <span>{m}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </SurfaceCard>
  );
}
